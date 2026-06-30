import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { encodePassword } from '@studio/common/lib/passwords';
import { readAuthToken, type StoredAuthToken } from '@studio/common/lib/shared-config';
import {
	SITE_RUNTIME_NATIVE_PHP,
	SITE_RUNTIME_PLAYGROUND,
	SiteRuntime,
	getSiteRuntime,
} from '@studio/common/lib/site-runtime';
import { PullReprintCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, sprintf } from '@wordpress/i18n';
import chalk from 'chalk';
import {
	getSetAdminCredentialsRequestBody,
	shouldSetAdminCredentials,
	toUrlSearchParams,
} from 'cli/lib/admin-credentials';
import { enableReprintExporter, rotateReprintSecret } from 'cli/lib/api';
import {
	lockCliConfig,
	readCliConfig,
	saveCliConfig,
	type SiteData,
	type SiteStatus,
	unlockCliConfig,
} from 'cli/lib/cli-config/core';
import { findSiteByFolder, getSiteUrl, updateSiteLatestCliPid } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon, isProcessRunning } from 'cli/lib/daemon-client';
import {
	type ReprintProcessResult,
	runReprintCommandUntilComplete,
} from 'cli/lib/pull/migration-client';
import {
	getContentDirFromState,
	getReprintStatePath,
	hasSkippedFiles,
	readReprintState,
} from 'cli/lib/pull/reprint-state';
import {
	ensureImportedSiteSqliteReady,
	loadImportedRuntimeStartOptions,
	loadImportedRuntimeStartOptionsNative,
} from 'cli/lib/pull/runtime-start-options';
import { buildAutoLoginUrl } from 'cli/lib/site-utils';
import { fetchSyncableSites } from 'cli/lib/sync-api';
import { pickSyncSite } from 'cli/lib/sync-site-picker';
import { getPrettyPath } from 'cli/lib/utils';
import {
	startWordPressServer,
	stopWordPressServer,
	isServerRunning,
	StartServerOptions,
	getProcessName,
} from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';
import type { SyncSite } from '@studio/common/types/sync';

const logger = new Logger< LoggerAction >();

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'pull-reprint',
		describe: __(
			'Pull a remote WordPress site into an existing local site (run `studio create` first; remove with `studio delete`)'
		),
		builder: ( builderYargs ) => {
			return builderYargs
				.option( 'url', {
					type: 'string',
					describe: __( 'URL of the remote WordPress site to pull from (remote source)' ),
				} )
				.option( 'secret', {
					type: 'string',
					describe: __(
						'Shared HMAC secret configured in the migration plugin on the remote source'
					),
				} )
				.option( 'verbose', {
					type: 'boolean',
					describe: __( 'Show detailed error information and executed commands' ),
					default: false,
				} );
		},
		handler: async ( argv ) => {
			const verbose = argv.verbose as boolean;

			try {
				await runCommand(
					argv.path as string,
					argv.url as string | undefined,
					argv.secret as string | undefined,
					verbose
				);
			} catch ( error ) {
				if ( error instanceof PullError ) {
					logger.spinner.fail( __( 'Pull failed' ) );
					console.error( '\n' + chalk.bold.red( error.message ) );
					if ( verbose && error.technicalDetails ) {
						console.error( '\n' + chalk.dim( error.technicalDetails ) );
					} else if ( error.technicalDetails ) {
						console.error( chalk.dim( '\nRun with --verbose for detailed error output.' ) );
					}
				} else if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					logger.reportError( new LoggerError( __( 'Failed to pull site' ), error ) );
				}
			}
		},
	} );
};

const PULLS_ROOT = path.join( os.homedir(), '.studio', 'pulls' );

interface PullSession {
	sitePath: string;
	localUrl: string;
	technicalSiteDirectory: string;
	rawDirectory: string;
	stateDirectory: string;
	runtimeDirectory: string;
	runtimeBlueprintPath: string;
}

interface PullSource {
	secret: string;
	url: string;
	wpComSite?: SyncSite;
	wpComToken?: StoredAuthToken;
}

class PullError extends LoggerError {
	technicalDetails: string;

	constructor( userMessage: string, technicalDetails: string ) {
		super( userMessage );
		this.technicalDetails = technicalDetails;
	}
}

export async function runCommand(
	localPath: string,
	remoteUrl?: string,
	remoteSecret?: string,
	verbose = false
): Promise< void > {
	const site = await findSiteByFolder( localPath );
	if ( ! site ) {
		throw new LoggerError(
			sprintf(
				// translators: %s: the local site path.
				__( 'No Studio site found at %s. Run `studio create` first.' ),
				getPrettyPath( localPath )
			)
		);
	}

	const sourceSite = await resolveSourceSite( site, remoteUrl, remoteSecret, verbose );
	if ( ! sourceSite ) {
		return;
	}

	const { url: sourceSiteUrl } = sourceSite;
	let secret = sourceSite.secret;
	const normalizedRemoteUrl = normalizeSiteUrl( sourceSiteUrl );
	const studioMetadata = getPullSession( site );
	const apiUrl = getReprintApiUrlForSite( normalizedRemoteUrl );

	// `importComplete` is the durable marker for choosing a delta re-pull.
	const isRepull = Boolean( site.importComplete );

	// Check before mkdir so a newly-created state directory does not look resumable.
	const hadScratch =
		fs.existsSync( studioMetadata.stateDirectory ) &&
		fs.readdirSync( studioMetadata.stateDirectory ).length > 0;

	if ( isRepull ) {
		fs.rmSync( path.join( studioMetadata.stateDirectory, 'preflight.json' ), { force: true } );
	}

	fs.mkdirSync( studioMetadata.rawDirectory, { recursive: true } );
	fs.mkdirSync( studioMetadata.stateDirectory, { recursive: true } );
	fs.mkdirSync( studioMetadata.runtimeDirectory, { recursive: true } );
	fs.mkdirSync( studioMetadata.sitePath, { recursive: true } );

	if ( isRepull ) {
		console.log( `Updating "${ site.name }" from ${ normalizedRemoteUrl } (delta sync)` );
		console.log( '' );
	} else if ( hadScratch ) {
		console.log( `Resuming previous pull of "${ site.name }" from ${ normalizedRemoteUrl }` );
		console.log( '' );
	} else {
		console.log( `Pulling "${ site.name }" from ${ normalizedRemoteUrl }` );
	}
	console.log( `Technical directory: ${ studioMetadata.technicalSiteDirectory }` );
	console.log( `Site directory: ${ studioMetadata.sitePath }` );
	console.log( '' );

	// Capture the server's running state up front; a first pull restarts a
	// running site once it finishes (see the server-start step below).
	let wasRunning = false;
	try {
		wasRunning = Boolean( await isServerRunning( site.id ) );
	} finally {
		await disconnectFromDaemon();
	}

	// Persist the scratch path before any later failure so `studio delete` can clean it up.
	site.status = 'pulling';
	site.technicalSiteDirectory = studioMetadata.technicalSiteDirectory;
	await updateSiteRecord( site.id, ( record ) => {
		record.status = 'pulling';
		record.technicalSiteDirectory = studioMetadata.technicalSiteDirectory;
	} );

	try {
		// wpcomsh gates ?reprint-api on a 60-minute `reprint_exporter_enabled` window.
		if ( sourceSite.wpComSite && sourceSite.wpComToken ) {
			await enableReprintExporter(
				sourceSite.wpComSite.id,
				sourceSite.wpComToken.accessToken,
				verbose
			);
		}

		let preflight;
		try {
			preflight = await runPreflight(
				SITE_RUNTIME_NATIVE_PHP,
				studioMetadata,
				apiUrl,
				secret,
				verbose
			);
		} catch ( preflightError ) {
			// WP.com failures may only need a fresh secret and exporter window.
			if ( sourceSite.wpComSite && sourceSite.wpComToken ) {
				secret = await rotateReprintSecret(
					sourceSite.wpComSite.id,
					sourceSite.wpComToken.accessToken
				);
			} else {
				let token: StoredAuthToken | null;
				try {
					token = await readAuthToken();
				} catch {
					token = null;
				}
				if ( ! token ) {
					throw preflightError;
				}
				const sites = await fetchSyncableSites( token.accessToken );
				const matched = findMatchingWpComSite( sites, sourceSiteUrl );
				if ( ! matched || matched.syncSupport !== 'syncable' ) {
					throw preflightError;
				}
				sourceSite.wpComSite = matched;
				sourceSite.wpComToken = token;
				secret = await rotateReprintSecret( matched.id, token.accessToken );
			}
			// Secret rotation does not refresh wpcomsh's exporter gate.
			await enableReprintExporter(
				sourceSite.wpComSite.id,
				sourceSite.wpComToken.accessToken,
				verbose
			);
			preflight = await runPreflight(
				SITE_RUNTIME_NATIVE_PHP,
				studioMetadata,
				apiUrl,
				secret,
				verbose
			);
		}
		const origin = {
			remoteUrl: normalizedRemoteUrl,
			remoteSiteUrl: preflight.siteurl || normalizedRemoteUrl,
			tablePrefix: preflight.table_prefix || undefined,
			secret,
		};
		site.reprintOrigin = origin;
		await updateSiteRecord( site.id, ( record ) => {
			record.reprintOrigin = origin;
		} );

		normalizeReprintStateForEssentialFilesPull( studioMetadata.stateDirectory );
		await runFullPull(
			SITE_RUNTIME_NATIVE_PHP,
			studioMetadata,
			apiUrl,
			secret,
			verbose,
			! isRepull
		);

		logger.reportStart( LoggerAction.CREATE_SITE, `Linking pulled files to "${ site.name }"…` );
		site.runtimeBlueprintPath = studioMetadata.runtimeBlueprintPath;
		await updateSiteRecord( site.id, ( record ) => {
			record.runtimeBlueprintPath = studioMetadata.runtimeBlueprintPath;
		} );
		logger.reportSuccess( `Site "${ site.name }" updated` );
		logger.reportKeyValuePair( 'id', site.id );

		// The remote DB dump does not contain Studio's local auto-login user.
		if ( ! site.adminPassword ) {
			const adminPassword = encodePassword( crypto.randomBytes( 24 ).toString( 'base64url' ) );
			site.adminPassword = adminPassword;
			await updateSiteRecord( site.id, ( record ) => {
				record.adminPassword = adminPassword;
			} );
		}

		let runtimeStartOptions: StartServerOptions;
		if ( getSiteRuntime( site ) === SITE_RUNTIME_NATIVE_PHP ) {
			runtimeStartOptions = loadImportedRuntimeStartOptionsNative(
				studioMetadata.technicalSiteDirectory,
				studioMetadata.runtimeDirectory
			);
		} else {
			await ensureImportedSiteSqliteReady( studioMetadata.runtimeBlueprintPath );
			runtimeStartOptions = await loadImportedRuntimeStartOptions(
				studioMetadata.runtimeBlueprintPath
			);
		}

		// Avoid re-spinning PHP WASM to extract runtime.php constants on later starts.
		const startOptionsPath = path.join( studioMetadata.runtimeDirectory, 'start-options.json' );
		fs.writeFileSync( startOptionsPath, JSON.stringify( runtimeStartOptions, null, 2 ) + '\n' );

		logger.reportStart( LoggerAction.START_SITE, __( 'Starting WordPress server…' ) );

		try {
			await connectToDaemon();

			// First pulls restart an already-running server; re-pulls can update one in place.
			const runningProcess = await isProcessRunning( getProcessName( site.id ) );

			if ( ! isRepull && wasRunning ) {
				if ( runningProcess ) {
					await stopWordPressServer( site.id );
				}
				const processDesc = await startWordPressServer( site, logger, runtimeStartOptions );
				logger.reportSuccess( __( 'WordPress server restarted' ) );

				if ( processDesc.status === 'online' ) {
					await updateSiteLatestCliPid( site.id, processDesc.pid );
				}
			} else {
				const credentialsResult = runningProcess
					? await reapplyAdminCredentials( site )
					: 'unreachable';
				if ( runningProcess && credentialsResult !== 'unreachable' ) {
					logger.reportSuccess( __( 'WordPress server already running' ) );
					if ( runningProcess.status === 'online' ) {
						await updateSiteLatestCliPid( site.id, runningProcess.pid );
					}
				} else {
					const processDesc = await startWordPressServer( site, logger, runtimeStartOptions );
					logger.reportSuccess( __( 'WordPress server started' ) );

					if ( processDesc.status === 'online' ) {
						await updateSiteLatestCliPid( site.id, processDesc.pid );
					}
				}
			}
		} catch ( serverError ) {
			throw new LoggerError(
				__( 'Failed to start the WordPress server for the pulled site.' ),
				serverError
			);
		} finally {
			await disconnectFromDaemon();
		}

		if ( hasSkippedFiles( studioMetadata.stateDirectory ) ) {
			await downloadSkippedFiles( getSiteRuntime( site ), studioMetadata, apiUrl, secret, verbose );
		}

		await markImportComplete( site );
		await setSiteStatus( site, 'ready' );

		printCompletionMessage( site, studioMetadata.localUrl );
		process.exit( 0 );
	} catch ( error ) {
		// The site directory may be half-written; do not treat it as healthy until a re-run succeeds.
		await setSiteStatus( site, 'pull-failed' );

		const resumeCommand = [
			'studio pull-reprint',
			`--path "${ localPath }"`,
			`--url ${ normalizedRemoteUrl }`,
		];
		if ( remoteSecret ) {
			resumeCommand.push( '--secret <secret>' );
		}
		console.log( '' );
		console.log( 'To resume this pull, re-run the same command:' );
		console.log( `  ${ resumeCommand.join( ' ' ) }` );
		console.log( '' );

		if ( error instanceof LoggerError ) {
			throw error;
		}
		throw new LoggerError( __( 'Failed to pull site' ), error );
	}
}

/**
 * Runs `reprint preflight` against the remote site and caches the
 * site-identity fields at `stateDirectory/preflight.json`.
 */
async function runPreflight(
	runtime: SiteRuntime,
	sessionMetadata: PullSession,
	sourceSiteApiUrl: string,
	sourceSiteSecret: string,
	verbose = false
): Promise< {
	siteurl?: string;
	wp_version?: string;
	php_version?: string;
	table_prefix?: string;
} > {
	const preflightCachePath = path.join( sessionMetadata.stateDirectory, 'preflight.json' );

	if ( fs.existsSync( preflightCachePath ) ) {
		return JSON.parse( fs.readFileSync( preflightCachePath, 'utf-8' ) );
	}

	logger.reportStart( LoggerAction.PREFLIGHT, __( 'Initiating the migration…' ) );

	let preflightResult: ReprintProcessResult;
	try {
		preflightResult = await runReprintCommandUntilComplete(
			sessionMetadata.stateDirectory,
			sessionMetadata.rawDirectory,
			[
				'preflight',
				sourceSiteApiUrl,
				`--secret=${ sourceSiteSecret }`,
				'--no-adaptive',
				`--state-dir=${ sessionMetadata.stateDirectory }`,
				`--fs-root=${ sessionMetadata.rawDirectory }`,
			],
			undefined,
			{
				verboseCommands: verbose,
				runtime,
			}
		);
	} catch ( preflightError ) {
		const details =
			preflightError instanceof Error ? preflightError.message : String( preflightError );
		throw new PullError( __( 'Could not connect to the remote site.' ), details );
	}

	const raw = preflightResult.stdout.trim();
	let envelope: Record< string, unknown >;
	try {
		envelope = JSON.parse( raw );
	} catch {
		throw new PullError(
			__( 'The remote site did not respond with a recognized format.' ),
			`stdout: ${ raw }\nstderr: ${ preflightResult.stderr }`
		);
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const preflightData: any = envelope.data ?? envelope;
	if ( ! preflightData.ok ) {
		const errorDetail = preflightData.error || '';
		const isJsonParseError = /^Invalid JSON\b/i.test( String( errorDetail ) );
		const userMessage = isJsonParseError
			? __( 'The remote site responded with HTML instead of the expected export API.' )
			: __( 'Remote site preflight check failed.' );

		throw new PullError(
			userMessage,
			preflightResult.stdout.trim() + '\n' + preflightResult.stderr.trim()
		);
	}

	const preflight = {
		siteurl: preflightData.database?.wp?.siteurl || undefined,
		wp_version: preflightData.database?.wp?.wp_version || undefined,
		php_version: preflightData.php?.version || undefined,
		table_prefix: preflightData.database?.wp?.table_prefix || undefined,
	};

	fs.writeFileSync( preflightCachePath, JSON.stringify( preflight, null, 2 ) + '\n' );
	logger.reportSuccess(
		`Connected – WordPress ${ preflight.wp_version || 'unknown' }, PHP ${
			preflight.php_version || 'unknown'
		}`
	);
	return preflight;
}

/**
 * Reprint refuses to resume a files sync with a different --filter than
 * the one stored in its state, so reset only the filter metadata and
 * preserve the cursor/index files reprint needs for deltas.
 */
function normalizeReprintStateForEssentialFilesPull( stateDirectory: string ): void {
	const reprintState = readReprintState( stateDirectory );
	if ( reprintState?.filter && reprintState.filter !== 'essential-files' ) {
		const statePath = getReprintStatePath( stateDirectory );
		fs.writeFileSync(
			statePath,
			JSON.stringify(
				{
					...reprintState,
					status: 'complete',
					stage: null,
					filter: 'essential-files',
				},
				null,
				2
			) + '\n'
		);
	}
}

function getPullTechnicalDirectory( siteId: string ): string {
	return path.join( PULLS_ROOT, siteId );
}

/**
 * Runs reprint's composite pull pipeline in one child process.
 */
export async function runFullPull(
	runtime: SiteRuntime,
	metadata: PullSession,
	apiUrl: string,
	secret: string,
	verbose: boolean,
	force: boolean
): Promise< void > {
	const contentDir = getContentDirFromState( metadata.stateDirectory );
	const sqlitePath = contentDir
		? `${ metadata.rawDirectory }${ contentDir }/database/.ht.sqlite`
		: `${ metadata.sitePath }/wp-content/database/.ht.sqlite`;
	const reprintRuntime = runtime === SITE_RUNTIME_NATIVE_PHP ? 'nginx-fpm' : 'playground-cli';
	const args = [
		'pull',
		apiUrl,
		`--secret=${ secret }`,
		'--filter=essential-files',
		'--target-engine=sqlite',
		`--target-sqlite-path=${ sqlitePath }`,
		`--new-site-url=${ metadata.localUrl! }`,
		`--flatten-to=${ metadata.sitePath }`,
		`--runtime=${ reprintRuntime }`,
		'--start-runtime=none',
		`--output-dir=${ metadata.runtimeDirectory }`,
		'--no-adaptive',
		`--state-dir=${ metadata.stateDirectory }`,
		`--fs-root=${ metadata.rawDirectory }`,
	];

	if ( force ) {
		args.push( '--force' );
	}

	logger.reportStart( LoggerAction.DOWNLOAD_FILES, __( 'Pulling site…' ) );
	await runReprintCommandUntilComplete(
		metadata.stateDirectory,
		metadata.rawDirectory,
		args,
		( progress ) => logger.reportProgress( progress ),
		{
			progressLabel: __( 'Pulling site' ),
			mounts: [
				{ hostPath: metadata.sitePath, vfsPath: metadata.sitePath },
				{ hostPath: metadata.runtimeDirectory, vfsPath: metadata.runtimeDirectory },
			],
			verboseCommands: verbose,
			runtime,
		}
	);
	logger.reportSuccess( __( 'Site pulled' ) );
}

export async function downloadSkippedFiles(
	runtime: SiteRuntime,
	metadata: PullSession,
	apiUrl: string,
	secret: string,
	verbose: boolean
): Promise< void > {
	const reprintState = readReprintState( metadata.stateDirectory );
	const isResumingSkipped =
		reprintState?.stage === 'fetch-skipped' && reprintState?.status !== 'complete';

	// Do not overwrite a skipped-files run that already has its own resume cursor.
	if ( ! isResumingSkipped && hasSkippedFiles( metadata.stateDirectory ) ) {
		const statePath = getReprintStatePath( metadata.stateDirectory );
		if ( fs.existsSync( statePath ) ) {
			try {
				const currentState = JSON.parse( fs.readFileSync( statePath, 'utf-8' ) ) as Record<
					string,
					unknown
				>;
				fs.writeFileSync(
					statePath,
					JSON.stringify(
						{
							...currentState,
							command: 'files-sync',
							status: 'complete',
							stage: null,
							filter: 'essential-files',
						},
						null,
						2
					) + '\n'
				);
			} catch {
				// Leave reprint state untouched if it cannot be parsed.
			}
		}
	}

	logger.reportStart( LoggerAction.DOWNLOAD_FILES, __( 'Downloading remaining files…' ) );
	await runReprintCommandUntilComplete(
		metadata.stateDirectory,
		metadata.rawDirectory,
		buildFilesSyncArgs( metadata, apiUrl, secret, [
			...( isResumingSkipped ? [] : [ '--filter=skipped-earlier' ] ),
		] ),
		( progress ) => logger.reportProgress( progress ),
		{
			progressLabel: __( 'Remaining files' ),
			verboseCommands: verbose,
			runtime,
		}
	);
	logger.reportSuccess( __( 'Remaining files downloaded' ) );
}

export function normalizeSiteUrl( url: string ): string {
	const trimmedUrl = url.trim();
	const normalized = new URL(
		/^[a-z][a-z\d+.-]*:\/\//i.test( trimmedUrl ) ? trimmedUrl : `https://${ trimmedUrl }`
	);
	normalized.hash = '';
	normalized.pathname = normalized.pathname.replace( /\/+$/, '' ) || '/';
	normalized.searchParams.delete( 'reprint-api' );
	return normalized.toString();
}

export function findMatchingWpComSite< T extends { url: string } >(
	sites: T[],
	url: string
): T | undefined {
	const normalizedUrl = normalizeSiteUrl( url );
	const target = new URL( normalizedUrl );

	return sites.find( ( site ) => {
		try {
			const normalizedSiteUrl = normalizeSiteUrl( site.url );
			if ( normalizedSiteUrl === normalizedUrl ) {
				return true;
			}

			return new URL( normalizedSiteUrl ).host === target.host;
		} catch {
			return false;
		}
	} );
}

export async function resolveSourceSite(
	site: SiteData,
	url?: string,
	providedSecret?: string,
	_verbose = false
): Promise< PullSource | null > {
	if ( url && providedSecret ) {
		return { url, secret: providedSecret };
	}

	if (
		site.reprintOrigin &&
		( ! url || normalizeSiteUrl( url ) === site.reprintOrigin.remoteUrl )
	) {
		return {
			url: url ?? site.reprintOrigin.remoteUrl,
			secret: providedSecret ?? site.reprintOrigin.secret,
		};
	}

	const token = await readAuthToken();
	if ( ! token ) {
		throw new LoggerError(
			__(
				'WordPress.com authentication is required. Run `studio auth login` to pull a connected WordPress.com site, or provide both `--url` and `--secret` for a non-WordPress.com site.'
			)
		);
	}
	let sites: SyncSite[];
	try {
		sites = await fetchSyncableSites( token.accessToken );
	} catch ( error ) {
		throw new LoggerError( __( 'Failed to load WordPress.com sites' ), error );
	}

	let resolvedUrl: string;
	let wpComSite: SyncSite;

	if ( url ) {
		const matched = findMatchingWpComSite( sites, url );
		if ( ! matched ) {
			throw new LoggerError(
				__(
					'No secret was provided, and this URL is not one of your connected WordPress.com sites. Provide `--secret` for a non-WordPress.com site.'
				)
			);
		}
		if ( matched.syncSupport !== 'syncable' ) {
			throw new LoggerError(
				sprintf(
					// translators: %s: the site URL.
					__(
						'%s cannot be pulled. Pulling requires a WordPress.com site with hosting features enabled, or a self-hosted site (with `--url` and `--secret`).'
					),
					matched.url
				)
			);
		}
		resolvedUrl = url;
		wpComSite = matched;
	} else {
		const pullableSites = sites.filter( ( site ) => site.syncSupport === 'syncable' );
		if ( pullableSites.length === 0 ) {
			throw new LoggerError(
				__(
					'No pullable WordPress.com sites found. Pulling requires a WordPress.com site with hosting features; provide both `--url` and `--secret` to pull a self-hosted site.'
				)
			);
		}

		if ( pullableSites.length > 1 ) {
			if ( ! process.stdin.isTTY ) {
				throw new LoggerError(
					__( 'Multiple WordPress.com sites are available. Re-run with `--url <site-url>`.' )
				);
			}

			const picked = await pickSyncSite( sites, __( 'Select a site to pull from' ) );
			if ( ! picked ) {
				return null;
			}

			wpComSite = picked;
			resolvedUrl = picked.url;
		} else {
			wpComSite = pullableSites[ 0 ];
			resolvedUrl = wpComSite.url;
			console.log( `${ __( 'Using your only connected WordPress.com site:' ) } ${ resolvedUrl }` );
			console.log( '' );
		}
	}

	return {
		url: resolvedUrl,
		secret: await rotateReprintSecret( wpComSite.id, token.accessToken ),
		wpComSite,
		wpComToken: token,
	};
}

export function getPullSession( site: SiteData ): PullSession {
	const technicalSiteDirectory = getPullTechnicalDirectory( site.id );
	return {
		sitePath: site.path,
		localUrl: getSiteUrl( site ),
		technicalSiteDirectory,
		rawDirectory: path.join( technicalSiteDirectory, 'raw' ),
		stateDirectory: path.join( technicalSiteDirectory, 'state' ),
		runtimeDirectory: path.join( technicalSiteDirectory, 'runtime' ),
		runtimeBlueprintPath: path.join( technicalSiteDirectory, 'runtime', 'blueprint.json' ),
	};
}

/**
 * Reprint exporter uses a query marker rather than a REST route.
 */
export function getReprintApiUrlForSite( siteUrl: string ): string {
	const apiUrl = new URL( siteUrl );
	apiUrl.search = '?reprint-api';
	return apiUrl.toString();
}

function buildFilesSyncArgs(
	metadata: Pick< PullSession, 'stateDirectory' | 'rawDirectory' >,
	apiUrl: string,
	secret: string,
	extraArgs: string[] = []
): string[] {
	return [
		'files-sync',
		apiUrl,
		`--secret=${ secret }`,
		...extraArgs,
		// Per-batch ceiling, not a total-time budget.
		'--max-exec=30',
		'--no-adaptive',
		`--state-dir=${ metadata.stateDirectory }`,
		`--fs-root=${ metadata.rawDirectory }`,
	];
}

async function updateSiteRecord(
	siteId: string,
	apply: ( record: SiteData ) => void
): Promise< void > {
	try {
		await lockCliConfig();
		const cliConfig = await readCliConfig();
		const record = cliConfig.sites.find( ( s ) => s.id === siteId );
		if ( record ) {
			apply( record );
			await saveCliConfig( cliConfig );
		}
	} finally {
		await unlockCliConfig();
	}
}

async function markImportComplete( site: SiteData ): Promise< void > {
	if ( site.importComplete ) {
		return;
	}
	site.importComplete = true;
	await updateSiteRecord( site.id, ( record ) => {
		record.importComplete = true;
	} );
}

async function setSiteStatus( site: SiteData, status: SiteStatus ): Promise< void > {
	if ( site.status === status ) {
		return;
	}
	site.status = status;
	await updateSiteRecord( site.id, ( record ) => {
		record.status = status;
	} );
}

/**
 * Re-applies the site's stored admin credentials over the running
 * site's admin API after db-apply replaces the local database.
 */
export async function reapplyAdminCredentials(
	site: SiteData
): Promise< 'applied' | 'skipped' | 'unreachable' > {
	const credentials = {
		adminUsername: site.adminUsername,
		adminPassword: site.adminPassword,
		adminEmail: site.adminEmail,
	};
	if ( ! shouldSetAdminCredentials( credentials ) ) {
		return 'skipped';
	}

	let response: Response;
	try {
		response = await fetch( new URL( '/?studio-admin-api', getSiteUrl( site ) ), {
			method: 'POST',
			body: toUrlSearchParams( getSetAdminCredentialsRequestBody( credentials ) ),
			signal: AbortSignal.timeout( 15_000 ),
		} );
	} catch {
		return 'unreachable';
	}

	if ( ! response.ok ) {
		throw new LoggerError(
			sprintf(
				// translators: %d: HTTP status code.
				__( 'Failed to re-apply the admin credentials after the database refresh (HTTP %d).' ),
				response.status
			)
		);
	}

	return 'applied';
}

function printSiteUrls( localUrl: string ): void {
	console.log( __( 'Site URL: ' ), buildAutoLoginUrl( SITE_RUNTIME_PLAYGROUND, localUrl ) );
	console.log(
		__( 'WP Admin: ' ),
		buildAutoLoginUrl(
			SITE_RUNTIME_PLAYGROUND,
			localUrl,
			new URL( '/wp-admin/', localUrl ).toString()
		)
	);
	console.log( '' );
}

function printCompletionMessage( site: SiteData, localUrl: string ): void {
	console.log( '' );
	console.log( `Site "${ site.name }" pulled successfully.` );
	console.log( '' );
	if ( localUrl ) {
		printSiteUrls( localUrl );
	}
}
