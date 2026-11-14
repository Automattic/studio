import fs from 'fs';
import os from 'os';
import path from 'path';
import { createDeployIgnoreFilter } from '@studio/common/lib/deploy-ignore';
import { normalizeHostname } from '@studio/common/lib/normalize-hostname';
import { formatProgressLabel } from '@studio/common/lib/progress-label';
import { forgetRejectedConfig, readProviderConfig } from '@studio/common/lib/provider-config';
import { getRemoteSites, rememberRemoteSite } from '@studio/common/lib/remote-sites';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { getSiteTracksProps } from '@studio/common/lib/site-tracks';
import { getLatestLinkedPreview, getPreviewPublishWarning } from '@studio/common/lib/snapshots';
import {
	buildSyncEventProps,
	classifySyncSelection,
} from '@studio/common/lib/sync/build-sync-event-props';
import { SYNC_IGNORE_DEFAULTS } from '@studio/common/lib/sync/constants';
import { SyncCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { SyncOption } from '@studio/common/types/sync';
import {
	getProvider,
	getProviderSites,
	parseRemoteSite,
	type ProviderConfigs,
	type ProviderSites,
	type PushContent,
	type PushStatus,
	type SitesProviderId,
} from '@studio/providers';
import { getProviderServices } from '@studio/providers/services';
import { __, sprintf } from '@wordpress/i18n';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { getExporter } from 'cli/lib/import-export/export/export-manager';
import { ExportOptions } from 'cli/lib/import-export/export/types';
import { confirm, select } from 'cli/lib/prompts';
import { connectInTerminal } from 'cli/lib/providers';
import { withSiteOperation } from 'cli/lib/site-operations';
import { getSiteVersion } from 'cli/lib/site-versions';
import { getSnapshotsFromConfig } from 'cli/lib/snapshots';
import { keepSqliteIntegrationUpdated } from 'cli/lib/sqlite-integration';
import { exportStaticContent } from 'cli/lib/static-content';
import { exitOnCancel, onCancel, reportSyncActivity } from 'cli/lib/sync-activity';
import { fetchSyncableSites, toLoggerError } from 'cli/lib/sync-api';
import { selectSyncItemsForPush } from 'cli/lib/sync-selector';
import { findSyncSiteByIdentifier, pickSyncSite } from 'cli/lib/sync-site-picker';
import { getTracksOrigin, recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';
import { findFailureCode } from 'cli/lib/utils';
import { requireAuthToken } from 'cli/lib/wpcom-auth';
import { Logger, LoggerError } from 'cli/logger';
import { handleExportEvents } from './export';
import type {
	SyncEventProps,
	SyncSelectionProps,
} from '@studio/common/lib/sync/build-sync-event-props';
import type { SyncFailurePhase } from '@studio/common/lib/sync/classify-sync-failure';
import type { PushPhase, SyncSite } from '@studio/common/types/sync';
import type { builder } from 'cli/commands/push.command';
import type { CommandArgs } from 'cli/types';

const defaultLogger = new Logger< LoggerAction >();

type RemoteSite = ProviderSites[ SitesProviderId ];
type Config = ProviderConfigs[ SitesProviderId ];

/**
 * Pushes the local site to a remote site on any provider. The provider's descriptor says what it
 * receives, the site's WordPress archive or a static export of its pages; reporting the progress
 * to the Studio apps, recording the result in Tracks, cleaning up after a cancel and remembering
 * the connection work the same for every provider.
 */
export async function runCommand(
	siteFolder: string,
	syncOptions?: SyncOption[],
	remoteSiteIdentifier?: string,
	logger: Logger< LoggerAction > = defaultLogger,
	{ includeOnly }: PushFlags = {}
): Promise< RemoteSite | undefined > {
	const startedAt = Date.now();
	const { provider, identifier } = parseRemoteSite( remoteSiteIdentifier );
	// The remote site is only known part-way through, but the setup steps before
	// it (auth, site load, remote-site fetch) can fail too — `runPush` reports the
	// site back through this ref so those failures are still recorded, just with
	// `sync_type: unknown`.
	const pushed: PushOutcome = {
		provider,
		selection: syncOptions
			? classifySyncSelection( { optionsToSync: syncOptions, specificSelectionPaths: includeOnly } )
			: undefined,
	};
	const settled = { direction: 'push' as const, provider };

	try {
		await runPush( siteFolder, syncOptions, includeOnly, identifier, logger, pushed );
	} catch ( error ) {
		if ( pushed.siteId ) {
			await reportSyncActivity( pushed.siteId, {
				kind: 'error',
				...settled,
				remoteSiteId: pushed.remoteSite?.id,
				message: error instanceof Error ? error.message : String( error ),
			} );
		}
		await recordSyncPushEvent(
			siteFolder,
			buildSyncEventProps( {
				startedAt,
				provider,
				site: pushed.remoteSite,
				selection: pushed.selection,
				error,
				hint: { code: findFailureCode( error ), phase: pushed.failurePhase },
			} )
		);
		throw error;
	}

	if ( pushed.siteId ) {
		await reportSyncActivity( pushed.siteId, {
			...settled,
			remoteSiteId: pushed.remoteSite?.id,
			...( pushed.launchError
				? { kind: 'error', message: pushed.launchError }
				: { kind: pushed.completed ? 'success' : 'cancelled' } ),
		} );
	}
	// Backing out of the site picker or the item selector returns without
	// completing — a cancel, which emits nothing.
	if ( pushed.completed ) {
		await recordSyncPushEvent(
			siteFolder,
			buildSyncEventProps( {
				startedAt,
				provider,
				site: pushed.remoteSite,
				selection: pushed.selection,
			} )
		);
	}
	return pushed.completed ? pushed.remoteSite : undefined;
}

type PushFlags = { includeOnly?: string[] };
type PushOutcome = {
	provider: SitesProviderId;
	selection?: SyncSelectionProps;
	siteId?: string;
	remoteSite?: RemoteSite;
	completed?: boolean;
	launchError?: string;
	// The step a failure is attributed to when its error names no cause of its own.
	failurePhase?: SyncFailurePhase;
};

// Each remote step's label, and where it starts and how much it spans of the overall progress.
const PUSH_PROGRESS: Record< PushStatus[ 'phase' ], [ () => string, number, number ] > = {
	uploading: [ () => __( 'Uploading archive…' ), 20, 20 ],
	creatingRemoteBackup: [ () => __( 'Backing up remote site…' ), 40, 20 ],
	applyingChanges: [ () => __( 'Applying changes…' ), 60, 35 ],
	finishing: [ () => __( 'Almost there…' ), 99, 0 ],
	launching: [ () => __( 'Launching site…' ), 99, 0 ],
};

const FAILURE_PHASES: Record< PushPhase, SyncFailurePhase > = {
	creatingBackup: 'local_export',
	uploading: 'upload',
	creatingRemoteBackup: 'remote_backup',
	applyingChanges: 'remote_import',
	finishing: 'remote_import',
	launching: 'remote_import',
};

async function runPush(
	siteFolder: string,
	syncOptions: SyncOption[] | undefined,
	includeOnly: string[] | undefined,
	identifier: string | undefined,
	logger: Logger< LoggerAction >,
	pushed: PushOutcome
): Promise< void > {
	const { provider } = pushed;
	const sites = getProviderSites( provider );
	const service = getProviderServices( provider ).sites!;
	const config = await requireConfig( provider );

	logger.reportStart( LoggerAction.LOAD_SITES, __( 'Loading site…' ) );
	const site = await getSiteByFolder( siteFolder );
	logger.reportSuccess( __( 'Site loaded' ) );
	pushed.siteId = site.id;
	const reportPhase = ( phase?: PushPhase, progress?: number ) => {
		if ( phase ) {
			pushed.failurePhase = FAILURE_PHASES[ phase ];
		}
		void reportSyncActivity( site.id, {
			kind: 'pending',
			direction: 'push',
			provider,
			remoteSiteId: pushed.remoteSite?.id,
			...( phase ? { phase } : {} ),
			...( progress === undefined ? {} : { progress: Math.round( progress ) } ),
		} );
	};
	reportPhase();

	if ( sites.content !== 'static' ) {
		logger.reportStart(
			LoggerAction.INSTALL_SQLITE,
			__( 'Setting up SQLite integration, if needed…' )
		);
		await keepSqliteIntegrationUpdated( siteFolder );
		logger.reportSuccess( __( 'SQLite integration configured as needed' ) );
	}

	const remoteSite = await forgetRejectedConfig( provider, () =>
		provider === 'wpcom'
			? resolveWpcomSite( ( config as { token: string } ).token, site.id, identifier, logger )
			: resolveRemoteSite( provider, config, site, identifier, logger )
	);
	if ( ! remoteSite ) {
		return;
	}
	pushed.remoteSite = remoteSite;
	reportPhase();

	if ( sites.previews ) {
		try {
			await warnIfPreviewIsBehind( site, Number( remoteSite.id ), logger );
		} catch {
			// A preview comparison is advisory.
		}
	}

	let optionsToSync: SyncOption[] = [ 'all' ];
	let specificSelectionPaths: string[] | undefined;

	if ( ! sites.selective ) {
		// The whole site, whatever was asked.
	} else if ( syncOptions ) {
		optionsToSync = syncOptions;
		specificSelectionPaths = includeOnly;
	} else {
		const selection = await selectSyncItemsForPush( site.path );
		if ( ! selection ) {
			return;
		}
		optionsToSync = selection.optionsToSync;
		specificSelectionPaths = selection.specificSelectionPaths;
	}

	pushed.selection ??= classifySyncSelection( { optionsToSync, specificSelectionPaths } );

	reportPhase( 'creatingBackup' );
	const tempDir = await fs.promises.mkdtemp( path.join( os.tmpdir(), 'studio-sync' ) );
	const removeTempDir = () => fs.promises.rm( tempDir, { recursive: true, force: true } );
	const forgetTempDir = onCancel( removeTempDir );

	try {
		let localVersionId: string | null = null;
		const captureVersion = async () => {
			if ( ! optionsToSync.includes( 'all' ) || specificSelectionPaths?.length ) return;
			try {
				localVersionId = await getSiteVersion( site.id, site.path );
			} catch {
				/* Comparison must not block publishing. */
			}
		};
		let content: PushContent;
		if ( sites.content === 'static' ) {
			// Starting a stopped site can update its files. Capture the version after startup
			// and before rendering the static pages.
			content = await exportStaticContent(
				site.path,
				remoteSite.url,
				path.join( tempDir, 'site' ),
				captureVersion
			);
		} else {
			await captureVersion();
			content = await exportArchive(
				provider,
				site,
				tempDir,
				optionsToSync,
				specificSelectionPaths,
				logger
			);
		}
		const uploadLabel =
			content.kind === 'archive' ? __( 'Uploading archive…' ) : __( 'Uploading files…' );

		// Push progress: Export (0-20%) → Upload (20-40%) → Remote backup (40-60%) → Import (60-99%) → Done (100%)

		// Suppress DEP0169 warning from tus-js-client's internal use of url.parse()
		const originalEmit = process.emit.bind( process );
		// @ts-expect-error Overriding process.emit to filter deprecation warnings
		process.emit = ( event: string, ...args: unknown[] ) => {
			if ( event === 'warning' && ( args[ 0 ] as { code?: string } )?.code === 'DEP0169' ) {
				return false;
			}
			return ( originalEmit as ( ...a: any[] ) => boolean )( event, ...args );
		};

		const abortUpload = new AbortController();
		let uploading = true;
		let lastReported = '';
		let cancelCount = 0;
		const onSigint = () => {
			cancelCount++;
			if ( cancelCount === 1 ) {
				console.error(
					__( 'Press Ctrl+C again to cancel. The upload cannot be safely cancelled mid-transfer.' )
				);
			} else if ( uploading ) {
				abortUpload.abort( new Error( 'Upload aborted' ) );
				logger.reportError( new LoggerError( __( 'Upload cancelled' ) ) );
			}
		};
		process.on( 'SIGINT', onSigint );

		const launchAfterPush = 'launchAfterPush' in remoteSite && remoteSite.launchAfterPush;
		logger.reportStart( LoggerAction.UPLOAD, formatProgressLabel( uploadLabel, 20 ) );
		try {
			const result = await forgetRejectedConfig( provider, () =>
				service.push(
					config as never,
					remoteSite as never,
					content,
					{ optionsToSync, specificSelectionPaths, launchAfterPush },
					( { phase, progress } ) => {
						const reported = `${ phase }:${ progress === undefined ? '' : Math.round( progress ) }`;
						// The upload reports every chunk; the remote steps report every poll, which a
						// Studio app that restarts or reloads needs to show the push again.
						if ( phase !== 'uploading' || reported !== lastReported ) {
							reportPhase( phase, progress );
						}
						lastReported = reported;
						uploading = phase === 'uploading';
						const [ label, start, span ] = PUSH_PROGRESS[ phase ];
						logger.reportProgress(
							formatProgressLabel(
								phase === 'uploading' ? uploadLabel : label(),
								Math.round( start + ( ( progress ?? 0 ) / 100 ) * span )
							)
						);
					},
					abortUpload.signal
				)
			);
			pushed.launchError = result?.launchError;
			if ( launchAfterPush && ! pushed.launchError ) {
				( remoteSite as SyncSite ).launchAfterPush = false;
			}
		} catch ( error ) {
			throw toLoggerError( error, __( 'Push failed' ) );
		} finally {
			process.removeListener( 'SIGINT', onSigint );
			process.emit = originalEmit;
		}

		// Remember this connection so future push/pull runs (and the Desktop UI)
		// can surface it without re-selecting from the full site list.
		try {
			await rememberRemoteSite( provider, site.id, remoteSite as never, 'push', localVersionId );
		} catch ( error ) {
			logger.reportError( new LoggerError( 'Failed to save connected site', error ), false );
		}

		logger.reportSuccess(
			sprintf( __( 'Successfully pushed to %1$s (%2$s)' ), remoteSite.name, remoteSite.url )
		);
		if ( pushed.launchError ) {
			logger.reportError( new LoggerError( pushed.launchError ), false );
		}
		pushed.completed = true;
	} finally {
		forgetTempDir();
		await removeTempDir();
	}
}

// The provider's config. In a terminal, offers to sign in to WordPress.com, or to connect a
// provider that connects with a device sign-in.
/**
 * Says so when the latest preview of the WordPress.com site was made from another version of this
 * local site: publishing sends the site as it is now, including changes that preview didn't show.
 */
async function warnIfPreviewIsBehind(
	site: { id: string; path: string },
	remoteSiteId: number,
	logger: Logger< LoggerAction >
): Promise< void > {
	const token = await readAuthToken();
	if ( ! token ) {
		return;
	}
	const preview = getLatestLinkedPreview(
		await getSnapshotsFromConfig( token.id ),
		site.id,
		remoteSiteId
	);
	if (
		preview?.versionId &&
		( await getSiteVersion( site.id, site.path ) ) !== preview.versionId
	) {
		logger.reportWarning( getPreviewPublishWarning( preview ) );
	}
}

async function requireConfig( provider: SitesProviderId ): Promise< Config > {
	if ( provider === 'wpcom' ) {
		return { token: ( await requireAuthToken( 'auth' ) ).accessToken } as Config;
	}
	const config = await readProviderConfig( provider );
	if ( config ) {
		return config;
	}
	const { label } = getProvider( provider );
	if (
		! process.stdin.isTTY ||
		! ( await confirm( { message: sprintf( __( 'Connect %s now?' ), label ) } ) )
	) {
		throw new LoggerError(
			sprintf( __( 'Connect %s first.' ), label ),
			undefined,
			'auth_required'
		);
	}
	await connectInTerminal( provider );
	return ( await readProviderConfig( provider ) )!;
}

async function resolveWpcomSite(
	token: string,
	localSiteId: string,
	identifier: string | undefined,
	logger: Logger< LoggerAction >
): Promise< SyncSite | undefined > {
	logger.reportStart( LoggerAction.FETCH_REMOTE_SITES, __( 'Fetching WordPress.com sites…' ) );
	const remoteSites = await fetchSyncableSites( token );
	logger.spinner.stop();

	const remoteSite = identifier
		? findSyncSiteByIdentifier( remoteSites, identifier )
		: await pickSyncSite( remoteSites, __( 'Select a site to push to' ) );
	if ( ! remoteSite ) {
		return undefined;
	}
	const connection = ( await getRemoteSites( 'wpcom', localSiteId ) ).find(
		( connected ) => connected.id === remoteSite.id
	);
	return connection?.launchAfterPush ? { ...remoteSite, launchAfterPush: true } : remoteSite;
}

const NEW_SITE = Symbol( 'new-site' );

/**
 * A provider's site to push to: the one `identifier` names (its ID or URL), the one the local
 * site last pushed to, or, in a terminal, one the user picks or creates.
 */
async function resolveRemoteSite(
	provider: SitesProviderId,
	config: Config,
	site: { id: string; name: string },
	identifier: string | undefined,
	logger: Logger< LoggerAction >
): Promise< RemoteSite | undefined > {
	if ( ! identifier ) {
		const [ last ] = ( await getRemoteSites( provider, site.id ) ).sort( ( a, b ) =>
			( b.lastPushTimestamp ?? '' ).localeCompare( a.lastPushTimestamp ?? '' )
		);
		if ( last ) {
			const {
				localSiteId: _localSiteId,
				lastPushTimestamp: _push,
				lastPullTimestamp: _pull,
				...remoteSite
			} = last;
			return remoteSite as RemoteSite;
		}
	}

	const { label } = getProvider( provider );
	const service = getProviderServices( provider ).sites!;
	logger.reportStart(
		LoggerAction.FETCH_REMOTE_SITES,
		sprintf( __( 'Fetching %s sites…' ), label )
	);
	let remoteSites: RemoteSite[];
	try {
		remoteSites = await service.list( config as never );
	} catch ( error ) {
		throw toLoggerError( error, sprintf( __( 'Failed to load your %s sites' ), label ) );
	}
	logger.spinner.stop();

	if ( identifier ) {
		const normalized = normalizeHostname( identifier );
		const remoteSite = remoteSites.find(
			( candidate ) =>
				String( candidate.id ) === identifier ||
				normalizeHostname( candidate.url ) === normalized ||
				( 'slug' in candidate && candidate.slug === identifier )
		);
		if ( ! remoteSite ) {
			throw new LoggerError( sprintf( __( 'No site found matching "%s"' ), identifier ) );
		}
		const issue = getProviderSites( provider ).issue( remoteSite, 'push' );
		if ( issue ) {
			throw new LoggerError( issue );
		}
		return remoteSite;
	}

	if ( ! process.stdin.isTTY ) {
		throw new LoggerError(
			sprintf( __( 'Choose a site with `--remote-site %s:<site>` (its ID or URL).' ), provider )
		);
	}
	const choice = await select< RemoteSite | typeof NEW_SITE >( {
		message: __( 'Select a site to push to' ),
		choices: [
			...( service.create
				? [ { name: sprintf( __( 'New site "%s"' ), site.name ), value: NEW_SITE } as const ]
				: [] ),
			...remoteSites.map( ( remoteSite ) => ( {
				name: `${ remoteSite.name } (${ remoteSite.url })`,
				value: remoteSite,
			} ) ),
		],
	} );
	if ( choice !== NEW_SITE ) {
		return choice;
	}
	try {
		return await forgetRejectedConfig( provider, () =>
			service.create!( config as never, { name: site.name } )
		);
	} catch ( error ) {
		throw toLoggerError( error, sprintf( __( 'Failed to create the %s site' ), label ) );
	}
}

async function exportArchive(
	provider: SitesProviderId,
	site: Awaited< ReturnType< typeof getSiteByFolder > >,
	tempDir: string,
	optionsToSync: SyncOption[],
	specificSelectionPaths: string[] | undefined,
	logger: Logger< LoggerAction >
): Promise< PushContent > {
	const archivePath = path.join( tempDir, `push-${ site.id }-${ Date.now() }.tar.gz` );

	const includes: ExportOptions[ 'includes' ] = optionsToSync.includes( 'all' )
		? { database: true, wpContent: true }
		: {
				database: optionsToSync.includes( 'sqls' ),
				wpContent:
					optionsToSync.includes( 'uploads' ) ||
					optionsToSync.includes( 'plugins' ) ||
					optionsToSync.includes( 'themes' ) ||
					optionsToSync.includes( 'contents' ),
		  };

	const deployIgnore = await createDeployIgnoreFilter( site.path, SYNC_IGNORE_DEFAULTS );

	const exporter = await getExporter( {
		site,
		backupFile: archivePath,
		includes,
		phpVersion: site.phpVersion,
		splitDatabaseDumpByTable: true,
		specificSelectionPaths,
		ignoreFilter: deployIgnore,
		stripStudioWpConfigConstants: true,
	} );

	if ( ! exporter ) {
		throw new LoggerError(
			__( 'No suitable exporter found for the provided backup file' ),
			undefined,
			'local_export'
		);
	}

	handleExportEvents( exporter, logger );
	await withSiteOperation( site.path, 'export', () => exporter.export() );

	const size = fs.statSync( archivePath ).size;
	const maxPushSize = getProviderSites( provider ).maxPushSize;
	if ( maxPushSize && size > maxPushSize ) {
		throw new LoggerError(
			sprintf(
				__(
					'The archive exceeds the %d GB size limit. Please reduce the size of your site and try again.'
				),
				Math.round( maxPushSize / 1024 ** 3 )
			),
			undefined,
			'size_limit'
		);
	}
	return {
		kind: 'archive',
		file: fs.createReadStream( archivePath ),
		name: path.basename( archivePath ),
		size,
	};
}

async function recordSyncPushEvent( siteFolder: string, props: SyncEventProps ): Promise< void > {
	try {
		await recordTracksEvent( TRACKS_EVENTS.SYNC_PUSH, {
			...props,
			...( await getSiteTracksProps( { siteFolder } ) ),
			...getTracksOrigin(),
		} );
	} catch {
		// Best-effort telemetry — never block or fail the push.
	}
}

export async function commandHandler( argv: CommandArgs< typeof builder > ) {
	exitOnCancel();
	try {
		await runCommand( argv.path, argv.options, argv.remoteSite, defaultLogger, {
			includeOnly: argv.includeOnly,
		} );
	} catch ( error ) {
		if ( error instanceof LoggerError ) {
			defaultLogger.reportError( error );
		} else {
			const loggerError = new LoggerError( __( 'Push failed' ), error );
			defaultLogger.reportError( loggerError );
		}
	}
}
