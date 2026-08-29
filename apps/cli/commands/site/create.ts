import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { confirm, input, password, select } from '@inquirer/prompts';
import { DEFAULT_WORDPRESS_VERSION, MINIMUM_WORDPRESS_VERSION } from '@studio/common/constants';
import { installAiInstructionsToSite } from '@studio/common/lib/agent-skills';
import {
	createBlueprintTempDirSync,
	removeBlueprintTempDir,
	removeBlueprintTempDirSync,
} from '@studio/common/lib/blueprint-bundle';
import { extractFormValuesFromBlueprint } from '@studio/common/lib/blueprint-settings';
import { validateBlueprintData } from '@studio/common/lib/blueprint-validation';
import { SITE_EVENTS } from '@studio/common/lib/cli-events';
import { getDomainNameValidationError } from '@studio/common/lib/domains';
import {
	arePathsEqual,
	isEmptyDir,
	isWordPressDirectory,
	pathExists,
	recursiveCopyDirectory,
} from '@studio/common/lib/fs-utils';
import { getWordPressVersion } from '@studio/common/lib/get-wordpress-version';
import { normalizeLandingPage } from '@studio/common/lib/landing-page';
import { DEFAULT_LOCALE } from '@studio/common/lib/locale';
import { isOnline } from '@studio/common/lib/network-utils';
import {
	createPassword,
	encodePassword,
	validateAdminEmail,
	validateAdminUsername,
} from '@studio/common/lib/passwords';
import { portFinder } from '@studio/common/lib/port-finder';
import { type TracksSiteCreateFlowType } from '@studio/common/lib/record-tracks-event';
import {
	hasDefaultDbBlock,
	removeDbConstants,
} from '@studio/common/lib/remove-default-db-constants';
import { readSharedConfig } from '@studio/common/lib/shared-config';
import {
	isFileAccessAllowedForRuntime,
	SITE_FILE_ACCESS_ALL_FILES,
	SITE_FILE_ACCESS_SITE_DIRECTORY,
	type SiteFileAccess,
} from '@studio/common/lib/site-file-access';
import {
	getSiteRuntime,
	SITE_MODE_NATIVE,
	SITE_MODE_SANDBOX,
	SITE_RUNTIME_NATIVE_PHP,
	siteRuntimeFromMode,
	type SiteRuntime,
} from '@studio/common/lib/site-runtime';
import { sortSites } from '@studio/common/lib/sort-sites';
import { getServerFilesPath } from '@studio/common/lib/well-known-paths';
import {
	isValidWordPressVersion,
	isWordPressVersionAtLeast,
} from '@studio/common/lib/wordpress-version-utils';
import { fetchWordPressVersions } from '@studio/common/lib/wordpress-versions';
import { SiteCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import {
	RecommendedPHPVersion,
	SupportedPHPVersions,
	type SupportedPHPVersion,
} from '@studio/common/types/php-versions';
import { __, sprintf } from '@wordpress/i18n';
import { isStepDefinition, type BlueprintV1Declaration } from '@wp-playground/blueprints';
import { bumpStat, getPlatformMetric } from 'cli/lib/bump-stat';
import {
	lockCliConfig,
	readCliConfig,
	saveCliConfig,
	SiteData,
	unlockCliConfig,
} from 'cli/lib/cli-config/core';
import { removeSiteFromConfig } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon, emitCliEvent } from 'cli/lib/daemon-client';
import {
	getAiInstructionsPath,
	getWordPressVersionPath,
} from 'cli/lib/dependency-management/paths';
import { updateServerFiles } from 'cli/lib/dependency-management/setup';
import { downloadWordPress } from 'cli/lib/dependency-management/wordpress';
import { copyLanguagePackToSite } from 'cli/lib/language-packs';
import { validateSupportedPhpVersion } from 'cli/lib/php-versions';
import {
	runWpCliCommandWithMessaging,
	type RunWpCliCommandOptions,
} from 'cli/lib/run-wp-cli-command';
import { getPreferredSiteLanguage } from 'cli/lib/site-language';
import { generateSiteName } from 'cli/lib/site-name';
import { getDefaultSitePath } from 'cli/lib/site-paths';
import { logSiteDetails, openSiteInBrowser, setupCustomDomain } from 'cli/lib/site-utils';
import { keepSqliteIntegrationUpdated } from 'cli/lib/sqlite-integration';
import { getTracksOrigin, recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';
import { StatsGroup } from 'cli/lib/types/bump-stats';
import { untildify } from 'cli/lib/utils';
import { ValidationError } from 'cli/lib/validation-error';
import { runBlueprint, startWordPressServer } from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const defaultLogger = new Logger< LoggerAction >();
// The importer vendors its own transformer layers (blocks-engine php-transformer and
// figma-transformer) inside this zip, so pinning the plugin pins the whole stack. To run
// against an unreleased transformer, build a paired zip with the importer's
// `npm run build:dev-package -- --blocks-engine-path <path>` and pass it to
// `--static-site-importer-path`.
const DEFAULT_STATIC_SITE_IMPORTER_PLUGIN_URL =
	'https://github.com/Automattic/static-site-importer/releases/download/v1.8.2/static-site-importer.zip';
const SSI_PLUGIN_SLUG = 'static-site-importer';
const STATIC_SITE_IMPORT_DIR = '.studio-import';
const STATIC_SITE_IMPORT_REQUEST_FILE = 'request.json';
const STATIC_SITE_IMPORT_PROGRESS_INTERVAL_MS = 30_000;
const DATA_LIBERATION_CAPTURE_RECEIPT_SCHEMA = 'data-liberation/capture-receipt/v1';
const STATIC_SITE_IMPORT_RECEIPT_SCHEMA = 'static-site-importer/import-cli-receipt/v1';
type StaticSiteImportProgressPhase = 'import' | 'finalization';

type StaticSiteImporterSource = {
	path: string;
	payload: Record< string, unknown >;
};

type StaticSiteImporterPlugin = string | { path: string };

export type CreateCommandOptions = {
	name?: string;
	siteId?: string;
	wpVersion: string;
	phpVersion: SupportedPHPVersion;
	runtime: SiteRuntime;
	fileAccess: SiteFileAccess;
	customDomain?: string;
	enableHttps: boolean;
	blueprint?: {
		contents: unknown;
		uri: string;
		staticSiteImport?: {
			request: string;
			bundlePath?: string;
		};
	};
	adminUsername?: string;
	adminPassword?: string;
	adminEmail?: string;
	noStart: boolean;
	skipBrowser: boolean;
	skipLogDetails: boolean;
	flowType?: TracksSiteCreateFlowType;
};

const SITE_CREATE_FLOW_TYPES: readonly TracksSiteCreateFlowType[] = [
	'new',
	'blueprint',
	'import',
	'sync',
	'duplicate',
];

function parseFlowType( value: string | undefined ): TracksSiteCreateFlowType | undefined {
	return SITE_CREATE_FLOW_TYPES.find( ( flowType ) => flowType === value );
}

function readSiteArtifact( artifactPath: string ): Record< string, unknown > {
	if ( ! fs.existsSync( artifactPath ) ) {
		throw new LoggerError( sprintf( __( 'Artifact file not found: %s' ), artifactPath ) );
	}

	try {
		const artifactContent = fs.readFileSync( artifactPath, 'utf-8' );
		const artifact = JSON.parse( artifactContent );
		if ( ! artifact || typeof artifact !== 'object' || Array.isArray( artifact ) ) {
			throw new Error( __( 'Artifact JSON must be an object.' ) );
		}
		return artifact as Record< string, unknown >;
	} catch ( error ) {
		throw new LoggerError(
			sprintf( __( 'Failed to parse artifact JSON file: %s' ), artifactPath ),
			error
		);
	}
}

function isUrl( value: string ): boolean {
	return value.startsWith( 'http://' ) || value.startsWith( 'https://' );
}

function sourceFilePayload( filePath: string, relativePath: string ): Record< string, string > {
	return {
		path: relativePath.replace( /\\/g, '/' ),
		content_base64: fs.readFileSync( filePath ).toString( 'base64' ),
	};
}

function collectSourceFiles( sourceDir: string ): Record< string, string >[] {
	const files: Record< string, string >[] = [];
	const walk = ( currentDir: string ) => {
		for ( const entry of fs.readdirSync( currentDir, { withFileTypes: true } ) ) {
			if ( entry.name === '.DS_Store' || entry.name === '__MACOSX' ) {
				continue;
			}

			const entryPath = path.join( currentDir, entry.name );
			if ( entry.isDirectory() ) {
				walk( entryPath );
				continue;
			}

			if ( entry.isFile() ) {
				files.push( sourceFilePayload( entryPath, path.relative( sourceDir, entryPath ) ) );
			}
		}
	};
	walk( sourceDir );
	return files;
}

function resolveDataLiberationWebsiteRoot( sourceDir: string ): string {
	const receiptPath = path.join( sourceDir, 'capture-receipt.json' );
	if ( ! fs.existsSync( receiptPath ) ) {
		return sourceDir;
	}

	const receipt = readSiteArtifact( receiptPath );
	if ( receipt.schema !== DATA_LIBERATION_CAPTURE_RECEIPT_SCHEMA ) {
		return sourceDir;
	}

	if ( typeof receipt.websiteRoot !== 'string' || ! receipt.websiteRoot.trim() ) {
		throw new LoggerError( __( 'Data Liberation capture receipt must declare a website root.' ) );
	}

	const outputRoot = path.resolve( sourceDir );
	const websiteRoot = path.resolve( sourceDir, receipt.websiteRoot );
	const relativeRoot = path.relative( outputRoot, websiteRoot );
	if ( relativeRoot === '..' || relativeRoot.startsWith( `..${ path.sep }` ) ) {
		throw new LoggerError(
			__( 'Data Liberation website root must stay inside the capture directory.' )
		);
	}
	if ( ! fs.existsSync( websiteRoot ) || ! fs.statSync( websiteRoot ).isDirectory() ) {
		throw new LoggerError(
			sprintf( __( 'Data Liberation capture root not found: %s' ), websiteRoot )
		);
	}

	return websiteRoot;
}

function resolveStaticSiteImporterSource( sourcePath: string ): StaticSiteImporterSource {
	if ( isUrl( sourcePath ) ) {
		throw new LoggerError(
			__( 'Remote URLs must be rendered by Data Liberation before SSI materialization.' )
		);
	}

	if ( ! fs.existsSync( sourcePath ) ) {
		throw new LoggerError( sprintf( __( 'Import source not found: %s' ), sourcePath ) );
	}

	const stat = fs.statSync( sourcePath );
	if ( stat.isDirectory() ) {
		const artifactPath = path.join( sourcePath, 'artifact.json' );
		if ( fs.existsSync( artifactPath ) ) {
			const artifact = readSiteArtifact( artifactPath );
			if ( artifact.schema === 'blocks-engine/php-transformer/site-artifact/v1' ) {
				return {
					path: artifactPath,
					payload: { artifact },
				};
			}
		}

		const files = collectSourceFiles( resolveDataLiberationWebsiteRoot( sourcePath ) );
		if ( files.length > 0 ) {
			return {
				path: sourcePath,
				payload: { files },
			};
		}

		throw new LoggerError( sprintf( __( 'Import source directory is empty: %s' ), sourcePath ) );
	}

	if ( ! stat.isFile() ) {
		throw new LoggerError(
			sprintf( __( 'Import source must be a file or directory: %s' ), sourcePath )
		);
	}

	const extension = path.extname( sourcePath ).toLowerCase();
	if ( extension === '.json' ) {
		const artifact = readSiteArtifact( sourcePath );
		return {
			path: sourcePath,
			payload: { artifact },
		};
	}

	if ( extension === '.zip' ) {
		return {
			path: sourcePath,
			payload: {
				archive: {
					name: path.basename( sourcePath ),
					content_base64: fs.readFileSync( sourcePath ).toString( 'base64' ),
				},
			},
		};
	}

	if ( extension === '.fig' ) {
		throw new LoggerError(
			__( 'Figma files are not supported by the canonical Static Site Importer command.' )
		);
	}

	return {
		path: sourcePath,
		payload: {
			files: [ sourceFilePayload( sourcePath, path.basename( sourcePath ) ) ],
		},
	};
}

function buildStaticSiteImporterRequest(
	source: StaticSiteImporterSource,
	siteName: string,
	originalSourceUrl?: string
): Record< string, unknown > {
	const payload = source.payload;
	let requestSource: Record< string, unknown >;
	let themeMaterialization: unknown;
	const artifact = payload.artifact;

	if ( artifact && typeof artifact === 'object' && ! Array.isArray( artifact ) ) {
		const {
			schema: _schema,
			entrypoint,
			files,
			theme_materialization,
			...metadata
		} = artifact as Record< string, unknown >;
		themeMaterialization = theme_materialization;
		requestSource = {
			type: 'files',
			entrypoint: typeof entrypoint === 'string' ? entrypoint : '',
			files: Array.isArray( files ) ? files : [],
			metadata,
		};
	} else if ( payload.archive && typeof payload.archive === 'object' ) {
		requestSource = { type: 'zip', zip: payload.archive };
	} else if ( Array.isArray( payload.files ) ) {
		requestSource = { type: 'files', files: payload.files };
	} else {
		throw new LoggerError( __( 'This source type is not supported by the canonical importer.' ) );
	}

	const request: Record< string, unknown > = {
		operation: 'apply',
		name: siteName,
		site_title: siteName,
		activate: true,
		overwrite: true,
		client_script_policy: 'isolated_preview',
		client_script_isolated: true,
		client_script_provenance: {
			ref: `studio-create-from:sha256:${ crypto
				.createHash( 'sha256' )
				.update( JSON.stringify( payload ) )
				.digest( 'hex' ) }`,
		},
		source_metadata: {
			source: 'studio-create-from',
			source_path: originalSourceUrl ?? source.path,
		},
		fail_on_quality: true,
		require_proven_dynamic_client_assets: true,
		seed_entities: true,
		materialize_dependencies: true,
		source: requestSource,
	};
	if ( themeMaterialization === 'block' || themeMaterialization === 'classic' ) {
		request.theme_materialization = themeMaterialization;
	}
	return request;
}

function artifactTitle( artifact: Record< string, unknown > ): string | undefined {
	const directTitle = artifact.site_title || artifact.title || artifact.name;
	if ( typeof directTitle === 'string' && directTitle.trim() ) {
		return directTitle.trim();
	}

	const provenance = artifact.provenance;
	if ( provenance && typeof provenance === 'object' && ! Array.isArray( provenance ) ) {
		const provenanceTitle = ( provenance as Record< string, unknown > ).title;
		if ( typeof provenanceTitle === 'string' && provenanceTitle.trim() ) {
			return provenanceTitle.trim();
		}
	}

	return undefined;
}

export function buildCreateFromSourceBlueprint(
	sourcePath: string,
	siteName: string,
	staticSiteImporterPlugin: StaticSiteImporterPlugin = DEFAULT_STATIC_SITE_IMPORTER_PLUGIN_URL,
	originalSourceUrl?: string
): {
	contents: BlueprintV1Declaration;
	uri: string;
	staticSiteImport: {
		request: string;
		bundlePath?: string;
	};
} {
	const source = resolveStaticSiteImporterSource( sourcePath );
	const request = buildStaticSiteImporterRequest( source, siteName, originalSourceUrl );
	const tempDir = createBlueprintTempDirSync();
	const blueprintPath = path.join( tempDir, 'blueprint.json' );
	const pluginData =
		typeof staticSiteImporterPlugin === 'string'
			? { resource: 'url' as const, url: staticSiteImporterPlugin }
			: { resource: 'bundled' as const, path: `${ SSI_PLUGIN_SLUG }.zip` };
	const blueprint: BlueprintV1Declaration = {
		landingPage: '/',
		features: {
			networking: true,
		},
		steps: [
			{
				step: 'installPlugin',
				pluginData,
				options: {
					activate: true,
					targetFolderName: SSI_PLUGIN_SLUG,
				},
			},
		],
	};

	try {
		if ( typeof staticSiteImporterPlugin !== 'string' ) {
			fs.copyFileSync(
				staticSiteImporterPlugin.path,
				path.join( tempDir, `${ SSI_PLUGIN_SLUG }.zip` )
			);
		}
		fs.writeFileSync( blueprintPath, `${ JSON.stringify( blueprint, null, 2 ) }\n` );
	} catch ( error ) {
		removeBlueprintTempDirSync( tempDir );
		throw error;
	}
	return {
		contents: blueprint,
		uri: blueprintPath,
		staticSiteImport: {
			request: `${ JSON.stringify( request, null, 2 ) }\n`,
			bundlePath: tempDir,
		},
	};
}

export function staticSiteImportProgressMessage(
	phase: StaticSiteImportProgressPhase,
	elapsedMs: number
): string {
	const elapsedSeconds = Math.floor( elapsedMs / 1000 );
	if ( phase === 'import' ) {
		return sprintf( __( 'Static site import… %d sec elapsed' ), elapsedSeconds );
	}
	return sprintf( __( 'Finalization… %d sec elapsed' ), elapsedSeconds );
}

function staticSiteImportRequestPath( sitePath: string ): string {
	return path.join( sitePath, STATIC_SITE_IMPORT_DIR, STATIC_SITE_IMPORT_REQUEST_FILE );
}

type WpCliResult = { exitCode: number; stdout: string; stderr: string };

async function runWpCli(
	site: SiteData,
	args: string[],
	options: RunWpCliCommandOptions = {}
): Promise< WpCliResult > {
	await using command = await runWpCliCommandWithMessaging( site, args, options );
	const [ exitCode, stdout, stderr ] = await Promise.all( [
		command.response.exitCode,
		command.response.stdoutText,
		command.response.stderrText,
	] );
	return { exitCode, stdout, stderr };
}

function wpCliFailureDetail( { exitCode, stdout, stderr }: WpCliResult ): string {
	return stderr.trim() || stdout.trim() || sprintf( __( 'WP-CLI exited with code %d.' ), exitCode );
}

function removeStagedStaticSiteImport( sitePath: string ): void {
	fs.rmSync( path.join( sitePath, STATIC_SITE_IMPORT_DIR ), { recursive: true, force: true } );
}

function decodeStaticSiteImportReceipt( output: string ): Record< string, unknown > | undefined {
	const lines = output.trim().split( /\r?\n/ );
	for ( let index = lines.length - 1; index >= 0; index-- ) {
		try {
			const receipt = JSON.parse( lines[ index ] );
			if ( receipt && typeof receipt === 'object' && ! Array.isArray( receipt ) ) {
				return receipt as Record< string, unknown >;
			}
		} catch {
			// WP-CLI may print informational lines before the terminal JSON receipt.
		}
	}
	return undefined;
}

function staticSiteImportReceiptError( receipt: Record< string, unknown > | undefined ): string {
	const response = receipt?.response;
	if ( ! response || typeof response !== 'object' || Array.isArray( response ) ) {
		return '';
	}
	const error = ( response as Record< string, unknown > ).error;
	if ( ! error || typeof error !== 'object' || Array.isArray( error ) ) {
		return '';
	}
	const code = ( error as Record< string, unknown > ).code;
	const message = ( error as Record< string, unknown > ).message;
	return [ code, message ].filter( ( value ) => typeof value === 'string' && value ).join( ': ' );
}

async function runStaticSiteImport(
	site: SiteData,
	request: string,
	resume = false,
	logger: Logger< LoggerAction > = defaultLogger
): Promise< boolean > {
	const requestPath = staticSiteImportRequestPath( site.path );
	if ( resume ) {
		if ( ! fs.existsSync( requestPath ) || fs.readFileSync( requestPath, 'utf-8' ) !== request ) {
			throw new LoggerError( __( 'The staged static site import request does not match.' ) );
		}
	} else {
		fs.mkdirSync( path.dirname( requestPath ), { recursive: true } );
		fs.writeFileSync( requestPath, request );
	}

	const startedAt = Date.now();
	logger.reportStart( LoggerAction.IMPORT_SITE, staticSiteImportProgressMessage( 'import', 0 ) );
	const progressTimer = setInterval( () => {
		logger.reportProgress( staticSiteImportProgressMessage( 'import', Date.now() - startedAt ) );
	}, STATIC_SITE_IMPORT_PROGRESS_INTERVAL_MS );
	progressTimer.unref?.();

	let result: WpCliResult;
	try {
		const liveOutput = getSiteRuntime( site ) === SITE_RUNTIME_NATIVE_PHP;
		result = await runWpCli(
			site,
			[
				'static-site-importer',
				'import',
				`--request=${ path.posix.join( STATIC_SITE_IMPORT_DIR, STATIC_SITE_IMPORT_REQUEST_FILE ) }`,
			],
			liveOutput ? { liveOutput, onLiveOutput: () => logger.spinner.stop() } : {}
		);
	} finally {
		clearInterval( progressTimer );
	}

	logger.reportProgress( staticSiteImportProgressMessage( 'import', Date.now() - startedAt ) );
	const { exitCode, stdout } = result;
	const receipt = decodeStaticSiteImportReceipt( stdout );
	const receiptError = staticSiteImportReceiptError( receipt );
	if ( exitCode !== 0 ) {
		throw new LoggerError(
			__( 'Static site import failed.' ),
			new Error( receiptError || wpCliFailureDetail( result ) )
		);
	}
	if ( receipt?.schema !== STATIC_SITE_IMPORT_RECEIPT_SCHEMA || receipt.status !== 'completed' ) {
		throw new LoggerError(
			__( 'Static site import returned an invalid terminal receipt.' ),
			new Error( receiptError || stdout.trim() || __( 'The importer did not return a receipt.' ) )
		);
	}

	const finalizationStartedAt = Date.now();
	logger.reportProgress( staticSiteImportProgressMessage( 'finalization', 0 ) );
	const cleanupSucceeded = await cleanupStaticSiteImporterPlugin( site, logger );
	logger.reportProgress(
		staticSiteImportProgressMessage( 'finalization', Date.now() - finalizationStartedAt )
	);
	logger.reportSuccess( __( 'Static site imported successfully' ) );
	return cleanupSucceeded;
}

async function cleanupStaticSiteImporterPlugin(
	site: SiteData,
	logger: Logger< LoggerAction > = defaultLogger
): Promise< boolean > {
	try {
		// `is-installed` exits non-zero when the plugin is absent, which keeps cleanup
		// idempotent across a rerun that already removed it.
		const installed = await runWpCli( site, [ 'plugin', 'is-installed', SSI_PLUGIN_SLUG ] );
		if ( installed.exitCode !== 0 ) {
			return true;
		}

		const deactivated = await runWpCli( site, [
			'plugin',
			'deactivate',
			SSI_PLUGIN_SLUG,
			'--quiet',
		] );
		if ( deactivated.exitCode !== 0 ) {
			throw new Error( wpCliFailureDetail( deactivated ) );
		}

		const deleted = await runWpCli( site, [ 'plugin', 'delete', SSI_PLUGIN_SLUG ] );
		if ( deleted.exitCode !== 0 ) {
			throw new Error( wpCliFailureDetail( deleted ) );
		}
		return true;
	} catch ( error ) {
		logger.reportError(
			new LoggerError(
				__(
					'Static Site Importer cleanup failed. The imported site and staged request were preserved.'
				),
				error
			),
			false
		);
		return false;
	}
}

export async function runCommand(
	sitePath: string,
	options: CreateCommandOptions,
	logger: Logger< LoggerAction > = defaultLogger
): Promise< void > {
	const siteRuntime = options.runtime;
	if ( ! isFileAccessAllowedForRuntime( siteRuntime, options.fileAccess ) ) {
		throw new LoggerError(
			__(
				'File access "all-files" requires the native PHP runtime. The sandbox only has access to the site directory.'
			)
		);
	}
	const phpVersion = validateSupportedPhpVersion( options.phpVersion );
	const isOnlineStatus = await isOnline();
	const staticSiteImport = options.blueprint?.staticSiteImport;
	// How far the static import got. `attempted` means the site now holds real import
	// state, so failure handling must preserve it (and the staged request) for a rerun
	// instead of tearing the site down.
	let importOutcome: 'not-attempted' | 'attempted' | 'succeeded' = 'not-attempted';
	// A site already registered at this path owns its own staged request; never clean it up.
	let siteAlreadyExisted = false;

	try {
		if ( isOnlineStatus ) {
			const updated = await updateServerFiles();
			if ( updated ) {
				logger.reportSuccess( __( 'Dependencies updated' ) );
			}
		}
	} catch ( error ) {
		// Errors here aren't critical and likely relate to things outside the user's control,
		// like network issues or bad API responses. Report them only in development.
		if ( process.env.NODE_ENV !== 'production' ) {
			const loggerError = new LoggerError( 'Failed to update dependencies', error );
			logger.reportError( loggerError, false );
		}
	}

	const createStartedAt = Date.now();

	try {
		logger.reportStart( LoggerAction.VALIDATE, __( 'Validating site configuration…' ) );

		const pathExistsResult = await pathExists( sitePath );
		const isEmptyDirResult = pathExistsResult && ( await isEmptyDir( sitePath ) );
		const isWordPressDirResult = pathExistsResult && isWordPressDirectory( sitePath );

		if ( pathExistsResult && ! isEmptyDirResult && ! isWordPressDirResult ) {
			throw new LoggerError(
				__( 'The selected directory is not empty nor an existing WordPress site.' )
			);
		}

		let blueprintUri: string | undefined;
		let blueprint: BlueprintV1Declaration | undefined;
		let blueprintCredentials: { adminUsername?: string; adminPassword?: string } | null = null;

		if ( options.blueprint ) {
			const validation = await validateBlueprintData( options.blueprint.contents );
			if ( ! validation.valid ) {
				throw new LoggerError( validation.error );
			}

			// `validateBlueprintData()` does not give us a proper type guard, but in reality, it ensures
			// `options.blueprint.contents` conforms to the `BlueprintV1Declaration` schema.
			const formValues = extractFormValuesFromBlueprint(
				options.blueprint.contents as BlueprintV1Declaration
			);
			if ( formValues.adminUsername || formValues.adminPassword ) {
				blueprintCredentials = {
					adminUsername: formValues.adminUsername,
					adminPassword: formValues.adminPassword,
				};
			}

			blueprintUri = options.blueprint.uri;
			blueprint = options.blueprint.contents as BlueprintV1Declaration;

			const blueprintHasMultisite = blueprint?.steps
				?.filter( isStepDefinition )
				.some( ( step ) => step.step === 'enableMultisite' );

			if ( blueprintHasMultisite && ! options.customDomain ) {
				throw new LoggerError(
					__(
						'The enableMultisite Blueprint step requires a custom domain. WordPress multisite does not support custom ports. Use --domain <name>.local to set a custom domain.'
					)
				);
			}
		}

		const cliConfig = await readCliConfig();
		const existingSite = cliConfig.sites.find( ( site ) => arePathsEqual( site.path, sitePath ) );
		siteAlreadyExisted = Boolean( existingSite );
		const canResumeStaticSiteImport =
			existingSite &&
			staticSiteImport &&
			fs.existsSync( staticSiteImportRequestPath( sitePath ) ) &&
			fs.readFileSync( staticSiteImportRequestPath( sitePath ), 'utf-8' ) ===
				staticSiteImport.request;
		if ( existingSite && staticSiteImport && canResumeStaticSiteImport ) {
			try {
				importOutcome = 'attempted';
				const cleanupSucceeded = await runStaticSiteImport(
					existingSite,
					staticSiteImport.request,
					true,
					logger
				);
				importOutcome = cleanupSucceeded ? 'succeeded' : 'attempted';
			} catch ( error ) {
				throw new LoggerError( __( 'Failed to import static site' ), error );
			}
			return;
		}
		if ( existingSite ) {
			throw new LoggerError( __( 'The selected directory is already in use.' ) );
		}

		for ( const site of cliConfig.sites ) {
			portFinder.addUnavailablePort( site.port );
		}

		if ( options.customDomain ) {
			const existingDomains = cliConfig.sites
				.map( ( site ) => site.customDomain )
				.filter( ( domain ): domain is string => Boolean( domain ) );
			const domainError = getDomainNameValidationError(
				true,
				options.customDomain,
				existingDomains
			);
			if ( domainError ) {
				throw new LoggerError( domainError );
			}
		}

		logger.reportSuccess( __( 'Site configuration validated' ) );

		if ( ! pathExistsResult ) {
			logger.reportStart( LoggerAction.CREATE_DIRECTORY, __( 'Creating site directory…' ) );
			fs.mkdirSync( sitePath, { recursive: true } );
			logger.reportSuccess( __( 'Site directory created' ) );
		}

		if ( options.wpVersion === 'latest' ) {
			const bundledWPPath = path.join( getServerFilesPath(), 'wordpress-versions', 'latest' );

			if ( ! ( await pathExists( bundledWPPath ) ) ) {
				throw new LoggerError(
					__(
						'Cannot set up WordPress. Bundled WordPress files not found. Please connect to the internet or reinstall Studio.'
					)
				);
			}

			logger.reportStart( LoggerAction.SETUP_WORDPRESS, __( 'Copying bundled WordPress…' ) );
			await recursiveCopyDirectory( bundledWPPath, sitePath );
			logger.reportSuccess( __( 'WordPress files copied' ) );
		} else if ( ! isOnlineStatus ) {
			throw new LoggerError(
				__(
					'Cannot set up WordPress while offline. Specific WordPress versions require an internet connection. Try using "latest" version or ensure internet connectivity.'
				)
			);
		} else if ( siteRuntime === SITE_RUNTIME_NATIVE_PHP && ! isWordPressDirResult ) {
			logger.reportStart(
				LoggerAction.SETUP_WORDPRESS,
				sprintf( __( 'Downloading WordPress %s…' ), options.wpVersion )
			);
			await downloadWordPress( options.wpVersion );
			logger.reportSuccess( __( 'WordPress files downloaded' ) );

			logger.reportStart(
				LoggerAction.SETUP_WORDPRESS,
				sprintf( __( 'Copying WordPress %s…' ), options.wpVersion )
			);
			await recursiveCopyDirectory( getWordPressVersionPath( options.wpVersion ), sitePath );
			logger.reportSuccess( __( 'WordPress files copied' ) );
		}

		logger.reportStart( LoggerAction.INSTALL_SQLITE, __( 'Setting up SQLite integration…' ) );
		await keepSqliteIntegrationUpdated( sitePath );
		logger.reportSuccess( __( 'SQLite integration configured' ) );

		try {
			const sharedConfig = await readSharedConfig();
			const selectedSkills = sharedConfig.selectedSkills ?? [];
			await installAiInstructionsToSite(
				{ path: sitePath, runtime: siteRuntime },
				getAiInstructionsPath(),
				selectedSkills
			);
		} catch ( error ) {
			logger.reportError(
				new LoggerError( __( 'Failed to install AI instructions. Proceeding anyway…' ), error ),
				false
			);
		}

		logger.reportStart( LoggerAction.ASSIGN_PORT, __( 'Assigning port…' ) );
		const port = await portFinder.getOpenPort();
		// translators: %d is the port number
		logger.reportSuccess( sprintf( __( 'Port assigned: %d' ), port ) );

		const siteName = options.name || path.basename( sitePath );
		const siteId = options.siteId || crypto.randomUUID();

		// Determine admin credentials: CLI args > Blueprint > defaults
		// External passwords need to be encoded; createPassword() already returns encoded
		const adminUsername = options.adminUsername || blueprintCredentials?.adminUsername || undefined;
		if ( adminUsername ) {
			const usernameError = validateAdminUsername( adminUsername );
			if ( usernameError ) {
				throw new LoggerError( usernameError );
			}
		}
		const adminEmail = options.adminEmail?.trim() || undefined;
		if ( adminEmail ) {
			const emailError = validateAdminEmail( adminEmail );
			if ( emailError ) {
				throw new LoggerError( emailError );
			}
		}

		const externalPassword = options.adminPassword || blueprintCredentials?.adminPassword;
		const adminPassword = externalPassword ? encodePassword( externalPassword ) : createPassword();

		const siteLanguage = await getPreferredSiteLanguage( options.wpVersion );

		if (
			siteLanguage &&
			siteLanguage !== DEFAULT_LOCALE &&
			options.wpVersion === DEFAULT_WORDPRESS_VERSION
		) {
			await copyLanguagePackToSite( sitePath, siteLanguage );
		}

		const siteDetails: SiteData = {
			id: siteId,
			name: siteName,
			path: sitePath,
			adminUsername,
			adminPassword,
			adminEmail,
			port,
			phpVersion,
			runtime: siteRuntime,
			fileAccess: options.fileAccess,
			running: false,
			status: 'ready',
			isWpAutoUpdating: options.wpVersion === DEFAULT_WORDPRESS_VERSION,
			customDomain: options.customDomain,
			enableHttps: options.enableHttps,
			landingPage: normalizeLandingPage( blueprint?.landingPage ),
		};

		logger.reportStart( LoggerAction.SAVE_SITE, __( 'Saving site…' ) );

		try {
			await lockCliConfig();
			const userData = await readCliConfig();

			userData.sites.push( siteDetails );
			sortSites( userData.sites );

			await saveCliConfig( userData );
			logger.reportSuccess( __( 'Site created successfully' ) );
		} finally {
			await unlockCliConfig();
		}

		if ( ! options.noStart ) {
			logger.reportStart( LoggerAction.START_DAEMON, __( 'Starting process daemon…' ) );
			await connectToDaemon();
			logger.reportSuccess( __( 'Process daemon started' ) );

			await setupCustomDomain( siteDetails, logger );

			const startMessage = blueprint
				? __( 'Starting WordPress server and applying Blueprint…' )
				: __( 'Starting WordPress server…' );
			logger.reportStart( LoggerAction.START_SITE, startMessage );
			try {
				await startWordPressServer( siteDetails, logger, {
					wpVersion: options.wpVersion,
					blueprint,
					blueprintUri,
					siteLanguage,
				} );
				logger.reportSuccess( __( 'WordPress server started' ) );

				stripWpConfigDbConstants( sitePath );

				siteDetails.running = true;
				siteDetails.url = siteDetails.customDomain
					? `${ siteDetails.enableHttps ? 'https' : 'http' }://${ siteDetails.customDomain }`
					: `http://localhost:${ siteDetails.port }`;

				if ( staticSiteImport ) {
					importOutcome = 'attempted';
					const cleanupSucceeded = await runStaticSiteImport(
						siteDetails,
						staticSiteImport.request,
						false,
						logger
					);
					importOutcome = cleanupSucceeded ? 'succeeded' : 'attempted';
				}

				if ( ! options.skipLogDetails ) {
					logSiteDetails( siteDetails );
				}
				if ( ! options.skipBrowser ) {
					await openSiteInBrowser( siteDetails );
				}
			} catch ( error ) {
				if ( importOutcome === 'not-attempted' ) {
					await removeSiteFromConfig( siteDetails.id );
					if ( ! isWordPressDirResult ) {
						await fs.promises.rm( sitePath, { recursive: true, force: true } );
					}
				}
				throw new LoggerError(
					staticSiteImport
						? __( 'Failed to import static site' )
						: __( 'Failed to start WordPress server' ),
					error
				);
			}
		} else {
			if ( blueprint ) {
				logger.reportStart( LoggerAction.START_DAEMON, __( 'Starting process daemon…' ) );
				await connectToDaemon();
				logger.reportSuccess( __( 'Process daemon started' ) );

				logger.reportStart( LoggerAction.START_SITE, __( 'Applying Blueprint…' ) );
				try {
					if ( ! blueprintUri ) {
						throw new LoggerError( __( 'Blueprint source path is missing' ) );
					}
					await runBlueprint( siteDetails, logger, {
						wpVersion: options.wpVersion,
						blueprint,
						blueprintUri,
						siteLanguage,
					} );
					logger.reportSuccess( __( 'Blueprint applied successfully' ) );

					stripWpConfigDbConstants( sitePath );
					if ( staticSiteImport ) {
						importOutcome = 'attempted';
						const cleanupSucceeded = await runStaticSiteImport(
							siteDetails,
							staticSiteImport.request,
							false,
							logger
						);
						importOutcome = cleanupSucceeded ? 'succeeded' : 'attempted';
					}
				} catch ( error ) {
					if ( importOutcome === 'not-attempted' ) {
						await removeSiteFromConfig( siteDetails.id );
						if ( ! isWordPressDirResult ) {
							await fs.promises.rm( sitePath, { recursive: true, force: true } );
						}
					}
					throw new LoggerError(
						staticSiteImport
							? __( 'Failed to import static site' )
							: __( 'Failed to apply Blueprint' ),
						error
					);
				}
			}
			console.log( '' );
			console.log( __( 'Site created successfully' ) );
			console.log( '' );
			if ( ! options.skipLogDetails ) {
				logSiteDetails( siteDetails );
			}
			console.log( __( 'Run "studio start" to start the site.' ) );
		}

		logger.reportKeyValuePair( 'id', siteDetails.id );
		logger.reportKeyValuePair( 'port', String( siteDetails.port ) );
		logger.reportKeyValuePair( 'running', String( siteDetails.running ) );

		// Tracks: the CLI is the sole emitter of site-creation, so every path a site comes into
		// existence (new/blueprint/import/sync/duplicate, app-spawned or standalone) is counted once.
		// Fires only on success; wrapped so best-effort telemetry can never fail a site creation.
		try {
			await recordTracksEvent( TRACKS_EVENTS.SITE_CREATE, {
				flow_type: options.flowType ?? ( blueprint ? 'blueprint' : 'new' ),
				php_version: siteDetails.phpVersion,
				wp_version: getWordPressVersion( sitePath ),
				custom_domain: !! options.customDomain,
				ssl_enabled: !! options.enableHttps,
				time_ms: Date.now() - createStartedAt,
				...getTracksOrigin(),
			} );
		} catch {
			// Best-effort telemetry — never block or fail a site creation.
		}

		await emitCliEvent( { event: SITE_EVENTS.CREATED, data: { siteId: siteDetails.id } } );
	} finally {
		// Keep the staged request only when it is resumable: the import ran but did not
		// finish. A site that already existed always keeps its own staged request.
		if (
			staticSiteImport &&
			( importOutcome === 'succeeded' ||
				( importOutcome === 'not-attempted' && ! siteAlreadyExisted ) )
		) {
			removeStagedStaticSiteImport( sitePath );
		}
		await disconnectFromDaemon();
	}
}

async function fetchBlueprint( url: string ) {
	const res = await fetch( url );

	if ( ! res.ok ) {
		throw new LoggerError( __( 'Failed to fetch Blueprint' ) );
	}

	try {
		return await res.json();
	} catch ( error ) {
		throw new LoggerError( __( 'Failed to parse Blueprint JSON' ), error );
	}
}

function stripWpConfigDbConstants( sitePath: string ): void {
	const wpConfigPath = path.join( sitePath, 'wp-config.php' );
	if ( ! fs.existsSync( wpConfigPath ) ) {
		return;
	}
	const content = fs.readFileSync( wpConfigPath, 'utf-8' );
	if ( hasDefaultDbBlock( content ) ) {
		fs.writeFileSync( wpConfigPath, removeDbConstants( content ), 'utf-8' );
	}
}

function readBlueprint( blueprintPath: string ) {
	if ( ! fs.existsSync( blueprintPath ) ) {
		throw new LoggerError( sprintf( __( 'Blueprint file not found: %s' ), blueprintPath ) );
	}

	try {
		const blueprintContent = fs.readFileSync( blueprintPath, 'utf-8' );
		return JSON.parse( blueprintContent );
	} catch ( error ) {
		throw new LoggerError(
			sprintf( __( 'Failed to parse Blueprint JSON file: %s' ), blueprintPath ),
			error
		);
	}
}

function coerceSiteId( value: string ) {
	// Validate UUID format (8-4-4-4-12 hex characters)
	const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
	if ( ! uuidRegex.test( value ) ) {
		throw new ValidationError( 'id', value, __( 'Must be a valid UUID' ) );
	}
	return value;
}

function coerceWpVersion( value: string ) {
	if ( ! isValidWordPressVersion( value ) ) {
		throw new ValidationError(
			'wp',
			value,
			__(
				'Must be: "latest", "nightly", or a valid version number (e.g., "6.4", "6.4.1", "6.4-beta1")'
			)
		);
	}

	if ( ! isWordPressVersionAtLeast( value, MINIMUM_WORDPRESS_VERSION ) ) {
		throw new ValidationError(
			'wp',
			value,
			sprintf( __( 'Must be: at least %s' ), MINIMUM_WORDPRESS_VERSION )
		);
	}

	return value;
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'create',
		describe: __( 'Create a new site' ),
		builder: ( yargs ) => {
			return yargs
				.option( 'id', {
					type: 'string',
					describe: __( 'Site ID (UUID format, used internally by Studio app)' ),
					hidden: true,
					coerce: coerceSiteId,
				} )
				.option( 'name', {
					type: 'string',
					describe: __( 'Site name' ),
				} )
				.option( 'wp', {
					type: 'string',
					describe: __( 'WordPress version (e.g., "latest", "6.4", "6.4.1")' ),
					defaultDescription: DEFAULT_WORDPRESS_VERSION,
					coerce: coerceWpVersion,
				} )
				.option( 'php', {
					type: 'string',
					describe: __( 'PHP version' ),
					choices: SupportedPHPVersions,
					defaultDescription: RecommendedPHPVersion,
				} )
				.option( 'runtime', {
					type: 'string',
					describe: __(
						'Run the site with native PHP ("native") or in the Playground sandbox ("sandbox")'
					),
					choices: [ SITE_MODE_NATIVE, SITE_MODE_SANDBOX ] as const,
					default: SITE_MODE_NATIVE,
				} )
				.option( 'file-access', {
					type: 'string',
					describe: __(
						'Which files PHP can access with the native PHP runtime: the site directory only, or all files'
					),
					choices: [ SITE_FILE_ACCESS_SITE_DIRECTORY, SITE_FILE_ACCESS_ALL_FILES ] as const,
					default: SITE_FILE_ACCESS_SITE_DIRECTORY,
				} )
				.option( 'domain', {
					type: 'string',
					describe: __( 'Custom domain (e.g., "mysite.local")' ),
				} )
				.option( 'https', {
					type: 'boolean',
					describe: __( 'Enable HTTPS for custom domain' ),
					implies: 'domain',
				} )
				.option( 'blueprint', {
					type: 'string',
					describe: __( 'Path or URL to Blueprint JSON file' ),
				} )
				.option( 'from', {
					type: 'string',
					describe: __( 'Create the site from a static import source' ),
					conflicts: 'blueprint',
					coerce: ( value ) => {
						if ( isUrl( value ) ) {
							return value;
						}

						return path.resolve( untildify( value ) );
					},
				} )
				.option( 'static-site-importer-url', {
					type: 'string',
					describe: __( 'Static Site Importer plugin zip URL for --from imports' ),
					defaultDescription: DEFAULT_STATIC_SITE_IMPORTER_PLUGIN_URL,
					conflicts: 'static-site-importer-path',
				} )
				.option( 'static-site-importer-path', {
					type: 'string',
					describe: __(
						'Local Static Site Importer plugin zip for --from imports, including a paired build from the importer’s build:dev-package'
					),
					conflicts: 'static-site-importer-url',
					coerce: ( value ) => {
						const pluginPath = path.resolve( untildify( value ) );
						if ( path.extname( pluginPath ).toLowerCase() !== '.zip' ) {
							throw new ValidationError(
								'static-site-importer-path',
								value,
								__( 'Must be a .zip file' )
							);
						}
						try {
							if ( ! fs.statSync( pluginPath ).isFile() ) {
								throw new Error();
							}
						} catch {
							throw new ValidationError(
								'static-site-importer-path',
								value,
								__( 'Must be an existing regular .zip file' )
							);
						}
						return pluginPath;
					},
				} )
				.option( 'original-blueprint-path', {
					type: 'string',
					hidden: true,
				} )
				.option( 'admin-username', {
					type: 'string',
					describe: __( 'Admin username (defaults to "admin")' ),
				} )
				.option( 'admin-password', {
					type: 'string',
					describe: __(
						'Admin password (auto-generated if not provided). Note: passwords in CLI arguments may be visible in process lists; consider using a Blueprint file for sensitive passwords.'
					),
				} )
				.option( 'admin-email', {
					type: 'string',
					describe: __( 'Admin email (defaults to "admin@localhost.com")' ),
				} )
				.option( 'start', {
					type: 'boolean',
					describe: __( 'Start the site after creation' ),
					default: true,
				} )
				.option( 'skip-browser', {
					type: 'boolean',
					describe: __( 'Skip opening the site in browser after starting' ),
					default: false,
				} )
				.option( 'skip-log-details', {
					type: 'boolean',
					describe: __( 'Skip printing site URL and admin credentials after creating' ),
					default: false,
				} )
				.option( 'flow-type', {
					// Internal telemetry hint for the `studio_site_created` Tracks event, set by the
					// desktop app when it spawns the CLI. Hidden from `--help`.
					type: 'string',
					hidden: true,
				} );
		},
		handler: async ( argv ) => {
			const artifact =
				argv.from && ! isUrl( argv.from ) && path.extname( argv.from ).toLowerCase() === '.json'
					? readSiteArtifact( argv.from )
					: undefined;
			let siteName = argv.name ?? ( artifact ? artifactTitle( artifact ) : undefined );
			let sitePath = argv.path;
			let wpVersion = argv.wp;
			let phpVersion = argv.php;
			let customDomain = argv.domain;
			let enableHttps = !! argv.https;
			let adminUsername = argv.adminUsername;
			let adminPassword = argv.adminPassword;
			let adminEmail = argv.adminEmail;
			const runtime = siteRuntimeFromMode( argv.runtime );
			const fileAccess = argv.fileAccess;
			if ( ! isFileAccessAllowedForRuntime( runtime, fileAccess ) ) {
				defaultLogger.reportError(
					new LoggerError(
						__(
							'File access "all-files" requires the native PHP runtime. The sandbox only has access to the site directory.'
						)
					)
				);
				return;
			}

			// Validate and resolve the WordPress version against available versions before prompting
			if ( wpVersion && wpVersion !== 'latest' && wpVersion !== 'nightly' ) {
				try {
					defaultLogger.reportStart( LoggerAction.VALIDATE, __( 'Checking WordPress version…' ) );
					const availableVersions = await fetchWordPressVersions();
					const matchedVersion = availableVersions.find(
						( v ) => v.value === wpVersion || v.value.startsWith( wpVersion + '.' )
					);
					if ( ! matchedVersion ) {
						const versionLabels = availableVersions
							.filter( ( v ) => v.value !== 'latest' )
							.map( ( v ) => v.label );
						defaultLogger.reportError(
							new LoggerError(
								sprintf(
									/* translators: %1$s: requested version, %2$s: list of available versions */
									__( 'WordPress version "%1$s" is not available. Available versions: %2$s' ),
									wpVersion,
									versionLabels.join( ', ' )
								)
							)
						);
						return;
					}
					// Resolve short versions to full versions (e.g. "6.7" → "6.7.2")
					if ( matchedVersion.value !== wpVersion ) {
						defaultLogger.reportSuccess(
							sprintf(
								/* translators: %1$s: requested version, %2$s: resolved version */
								__( 'WordPress version: %1$s → %2$s' ),
								wpVersion,
								matchedVersion.value
							)
						);
					} else {
						defaultLogger.reportSuccess(
							sprintf(
								/* translators: %s: WordPress version */
								__( 'WordPress version: %s' ),
								wpVersion
							)
						);
					}
					wpVersion = matchedVersion.value;
				} catch {
					// If we can't fetch versions (network issue), let it proceed and fail later
				}
			}

			try {
				if ( process.stdin.isTTY ) {
					if ( ! siteName ) {
						const defaultName = await generateSiteName();
						siteName = await input( {
							message: __( 'Site name:' ),
							default: defaultName,
						} );
					}

					const pathWasExplicitlyProvided = sitePath !== process.cwd();
					if ( ! pathWasExplicitlyProvided ) {
						const suggestedPath = getDefaultSitePath( siteName || __( 'My WordPress Website' ) );
						const promptedPath = await input( {
							message: __( 'Site path:' ),
							default: suggestedPath,
						} );
						sitePath = path.resolve( untildify( promptedPath ) );
					}

					if ( ! wpVersion ) {
						let wpChoices: { name: string; value: string }[];
						try {
							const versions = await fetchWordPressVersions();
							wpChoices = versions.map( ( v ) => ( {
								name: v.value === 'latest' ? `latest (${ v.label })` : v.label,
								value: v.value,
							} ) );
						} catch {
							// Offline or API failure — offer only "latest"
							wpChoices = [
								{
									name: __( 'Latest (recommended)' ),
									value: 'latest',
								},
							];
						}
						wpVersion = await select( {
							message: __( 'WordPress version:' ),
							choices: wpChoices,
							default: DEFAULT_WORDPRESS_VERSION,
							loop: false,
						} );
					}

					if ( ! phpVersion ) {
						phpVersion = await select( {
							message: __( 'PHP version:' ),
							choices: SupportedPHPVersions.map( ( v ) => ( {
								name: v === RecommendedPHPVersion ? sprintf( __( '%s (recommended)' ), v ) : v,
								value: v,
							} ) ),
							default: RecommendedPHPVersion,
						} );
					}

					if ( ! customDomain ) {
						const cliConfig = await readCliConfig();
						const existingDomains = cliConfig.sites
							.map( ( site ) => site.customDomain )
							.filter( ( domain ): domain is string => Boolean( domain ) );

						customDomain = await input( {
							message: __( 'Custom domain (leave empty to skip):' ),
							validate: ( value ) =>
								getDomainNameValidationError( !! value, value, existingDomains ) || true,
						} );
					}

					if ( customDomain && ! argv.https ) {
						enableHttps = await confirm( {
							message: __( 'Enable HTTPS?' ),
							default: false,
						} );
					}

					if ( ! adminUsername ) {
						adminUsername = await input( {
							message: __( 'Admin username:' ),
							default: 'admin',
							validate: ( value ) => validateAdminUsername( value ) || true,
						} );
					}

					if ( ! adminPassword ) {
						adminPassword = await password( {
							message: __( 'Admin password (leave empty to auto-generate):' ),
							mask: true,
						} );
						if ( ! adminPassword ) {
							adminPassword = undefined;
						}
					}

					if ( ! adminEmail ) {
						adminEmail = await input( {
							message: __( 'Admin email:' ),
							default: 'admin@localhost.com',
							validate: ( value ) => validateAdminEmail( value ) || true,
						} );
					}
				}
			} catch {
				// User cancelled the prompt (Ctrl+C)
				return;
			}

			// Apply defaults for non-interactive mode when flags weren't provided
			wpVersion = wpVersion ?? DEFAULT_WORDPRESS_VERSION;

			const config: CreateCommandOptions = {
				name: siteName,
				siteId: argv.id,
				wpVersion,
				phpVersion: phpVersion ?? RecommendedPHPVersion,
				runtime,
				fileAccess,
				customDomain,
				enableHttps,
				adminUsername,
				adminPassword,
				adminEmail,
				noStart: ! argv.start,
				skipBrowser: !! argv.skipBrowser,
				skipLogDetails: !! argv.skipLogDetails,
				flowType: parseFlowType( argv.flowType ),
			};

			try {
				const importSource = argv.from;
				// Remote URLs are rendered into a local source by Data Liberation before they
				// reach SSI; until that path exists here, `resolveStaticSiteImporterSource`
				// rejects them. `sourceUrl` still carries provenance for local captures.
				const sourceUrl = importSource && isUrl( importSource ) ? importSource : undefined;

				if ( importSource ) {
					config.blueprint = buildCreateFromSourceBlueprint(
						importSource,
						siteName || __( 'Imported Site' ),
						argv.staticSiteImporterPath
							? { path: argv.staticSiteImporterPath }
							: argv.staticSiteImporterUrl ?? DEFAULT_STATIC_SITE_IMPORTER_PLUGIN_URL,
						sourceUrl
					);
				} else if ( argv.blueprint ) {
					if ( isUrl( argv.blueprint ) ) {
						config.blueprint = {
							uri: argv.blueprint,
							contents: await fetchBlueprint( argv.blueprint ),
						};
					} else {
						const uri = path.resolve( untildify( argv.blueprint ) );

						config.blueprint = {
							uri,
							contents: readBlueprint( uri ),
						};

						// When invoked by the desktop app, the blueprint contents come from a temp file
						// but resources should be resolved relative to the original file location.
						// For gallery blueprints the path is a URL; use it directly.
						if ( argv.originalBlueprintPath ) {
							const originalPath = argv.originalBlueprintPath;
							config.blueprint.uri = isUrl( originalPath )
								? originalPath
								: path.resolve( originalPath );
						}
					}
				}

				try {
					await runCommand( sitePath, config );
				} finally {
					const bundlePath = config.blueprint?.staticSiteImport?.bundlePath;
					if ( bundlePath ) {
						await removeBlueprintTempDir( bundlePath ).catch( () => {} );
					}
				}

				if ( __ENABLE_CLI_TELEMETRY__ && ! argv.avoidTelemetry ) {
					bumpStat(
						__IS_PACKAGED_FOR_NPM__
							? StatsGroup.STUDIO_CLI_SITE_CREATE_NPM
							: StatsGroup.STUDIO_CLI_SITE_CREATE_APP,
						getPlatformMetric()
					);
				}
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					defaultLogger.reportError( error );
				} else {
					const loggerError = new LoggerError( __( 'Failed to create site' ), error );
					defaultLogger.reportError( loggerError );
				}
			}
		},
	} );
};
