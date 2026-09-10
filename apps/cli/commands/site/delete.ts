import fs from 'fs';
import path from 'path';
import { deleteAiSessionsForSite } from '@studio/common/ai/sessions/manage';
import { SITE_EVENTS } from '@studio/common/lib/cli-events';
import { removeAllConnectedWpcomSitesForLocalSite } from '@studio/common/lib/connected-sites';
import { arePathsEqual, isWordPressDirectory } from '@studio/common/lib/fs-utils';
import { readAuthToken, type StoredAuthToken } from '@studio/common/lib/shared-config';
import { getSessionsDirectory } from '@studio/common/lib/well-known-paths';
import { SiteCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, _n, sprintf } from '@wordpress/i18n';
import trash from 'trash';
import { deleteSnapshot } from 'cli/lib/api';
import { deleteSiteCertificate } from 'cli/lib/certificate-manager';
import {
	lockCliConfig,
	readCliConfig,
	saveCliConfig,
	unlockCliConfig,
	type SiteData,
} from 'cli/lib/cli-config/core';
import { connectToDaemon, disconnectFromDaemon, emitCliEvent } from 'cli/lib/daemon-client';
import { removeDomainFromHosts } from 'cli/lib/hosts-file';
import { withSiteOperations } from 'cli/lib/site-operations';
import { stopProxyIfNoSitesNeedIt } from 'cli/lib/site-utils';
import { getSnapshotsFromConfig, deleteSnapshotFromConfig } from 'cli/lib/snapshots';
import { getTracksOrigin, recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';
import { untildify } from 'cli/lib/utils';
import { isServerRunning, stopWordPressServer } from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const defaultLogger = new Logger< LoggerAction >();

export type DeleteSiteStatus = 'deleted' | 'skipped' | 'failed' | 'selected';

export type DeleteSiteOutcome = {
	identity: string;
	status: DeleteSiteStatus;
	id?: string;
	name?: string;
	path?: string;
	filePaths?: string[];
	error?: string;
	// Non-fatal problems: the site was deleted, but something was left behind (e.g. its files
	// could not be moved to trash). Machine consumers need these to distinguish a clean delete.
	warnings?: string[];
};

export type DeleteCommandResult = {
	dryRun: boolean;
	deleteFiles: boolean;
	sites: DeleteSiteOutcome[];
};

export type DeleteCommandOptions = {
	identities: string[];
	deleteFiles?: boolean;
	dryRun?: boolean;
	format?: 'text' | 'json';
	logger?: Logger< LoggerAction >;
	throwOnFailure?: boolean;
};

type ResolvedSite = {
	identity: string;
	site: SiteData;
	filePaths: string[];
};

async function deletePreviewSites(
	authToken: StoredAuthToken,
	siteFolder: string,
	logger: Logger< LoggerAction >
) {
	try {
		const snapshots = await getSnapshotsFromConfig( authToken.id, siteFolder );

		if ( snapshots.length > 0 ) {
			logger.reportStart(
				LoggerAction.DELETE_PREVIEW_SITES,
				// translators: %d is the number of associated preview sites
				sprintf(
					_n(
						'Deleting %d associated preview site…',
						'Deleting %d associated preview sites…',
						snapshots.length
					),
					snapshots.length
				)
			);

			await Promise.all(
				snapshots.map( async ( snapshot ) => {
					await deleteSnapshot( snapshot.atomicSiteId, authToken.accessToken );
					await deleteSnapshotFromConfig( snapshot.url );
				} )
			);

			logger.reportSuccess( __( 'Associated preview sites deleted' ) );
		}
	} catch ( error ) {
		logger.reportError(
			new LoggerError(
				__( 'Failed to delete associated preview sites. Proceeding anyway…' ),
				error
			),
			false
		);
	}
}

function getSelectedFilePaths( site: SiteData, deleteFiles: boolean ): string[] {
	if ( ! deleteFiles ) {
		return [];
	}

	return [ site.path, site.technicalSiteDirectory ].filter(
		( value ): value is string => typeof value === 'string' && fs.existsSync( value )
	);
}

function resolveSiteIdentity(
	identity: string,
	sites: SiteData[]
): { site?: SiteData; error?: string } {
	const trimmed = identity.trim();
	if ( ! trimmed ) {
		return { error: __( 'The specified directory is not added to Studio.' ) };
	}

	const byId = sites.find( ( site ) => site.id === trimmed );
	if ( byId ) {
		return { site: byId };
	}

	const expandedPath = untildify( trimmed );
	const resolvedPath = path.resolve( expandedPath );
	const byPath = sites.find(
		( site ) => arePathsEqual( site.path, expandedPath ) || arePathsEqual( site.path, resolvedPath )
	);
	if ( byPath ) {
		return { site: byPath };
	}

	if ( isWordPressDirectory( resolvedPath ) ) {
		return {
			error: __( 'The specified directory is not added to Studio. Use `studio create` to add it.' ),
		};
	}

	return { error: __( 'The specified directory is not added to Studio.' ) };
}

function outcomeForSite(
	item: ResolvedSite,
	status: DeleteSiteStatus,
	error?: string,
	warnings?: string[]
): DeleteSiteOutcome {
	const outcome: DeleteSiteOutcome = {
		identity: item.identity,
		status,
		id: item.site.id,
		name: item.site.name,
		path: item.site.path,
		filePaths: item.filePaths,
	};

	if ( error ) {
		outcome.error = error;
	}

	if ( warnings?.length ) {
		outcome.warnings = warnings;
	}

	return outcome;
}

function emitMachineOutput( result: DeleteCommandResult, logger: Logger< LoggerAction > ): void {
	const json = JSON.stringify( result );
	console.log( json );
	logger.reportKeyValuePair( 'deleteResult', json );
}

function firstFailureError( sites: DeleteSiteOutcome[] ): LoggerError {
	const failed = sites.find( ( site ) => site.status === 'failed' );
	return new LoggerError( failed?.error ?? __( 'Failed to delete site' ) );
}

function finishWithFailures(
	result: DeleteCommandResult,
	options: { format: 'text' | 'json'; throwOnFailure: boolean; logger: Logger< LoggerAction > }
): DeleteCommandResult {
	if ( options.format === 'json' ) {
		emitMachineOutput( result, options.logger );
	}

	if ( options.throwOnFailure ) {
		throw firstFailureError( result.sites );
	}

	process.exitCode = 1;
	return result;
}

export async function runCommand(
	siteFolder: string,
	deleteFiles: boolean = true,
	logger: Logger< LoggerAction > = defaultLogger
): Promise< void > {
	await runDeleteCommand( {
		identities: [ siteFolder ],
		deleteFiles,
		logger,
		throwOnFailure: true,
	} );
}

export async function runDeleteCommand(
	options: DeleteCommandOptions
): Promise< DeleteCommandResult > {
	const {
		identities,
		deleteFiles = true,
		dryRun = false,
		format = 'text',
		logger = defaultLogger,
		throwOnFailure = false,
	} = options;

	logger.reportStart( LoggerAction.LOAD_SITES, __( 'Resolving sites…' ) );
	const cliConfig = await readCliConfig();

	const resolved: ResolvedSite[] = [];
	const seenIds = new Set< string >();
	let validationFailed = false;
	const validationOutcomes: DeleteSiteOutcome[] = [];

	for ( const identity of identities ) {
		const { site, error } = resolveSiteIdentity( identity, cliConfig.sites );
		if ( ! site ) {
			validationFailed = true;
			validationOutcomes.push( { identity, status: 'failed', error } );
			continue;
		}

		const item: ResolvedSite = {
			identity,
			site,
			filePaths: getSelectedFilePaths( site, deleteFiles ),
		};

		if ( seenIds.has( site.id ) ) {
			validationFailed = true;
			validationOutcomes.push(
				outcomeForSite( item, 'failed', __( 'The same site was specified more than once.' ) )
			);
			continue;
		}

		seenIds.add( site.id );
		resolved.push( item );
		validationOutcomes.push( outcomeForSite( item, 'selected' ) );
	}

	if ( validationFailed ) {
		const result: DeleteCommandResult = {
			dryRun,
			deleteFiles,
			sites: validationOutcomes.map( ( outcome ) => {
				if ( outcome.status === 'selected' ) {
					return {
						...outcome,
						status: 'skipped',
						error: __( 'Skipped because the requested set failed validation.' ),
					};
				}
				return outcome;
			} ),
		};

		logger.reportError( firstFailureError( result.sites ), false );
		return finishWithFailures( result, { format, throwOnFailure, logger } );
	}

	logger.reportSuccess(
		sprintf( _n( 'Resolved %d site', 'Resolved %d sites', resolved.length ), resolved.length )
	);

	if ( dryRun ) {
		const result: DeleteCommandResult = {
			dryRun: true,
			deleteFiles,
			sites: validationOutcomes,
		};

		if ( format === 'json' ) {
			emitMachineOutput( result, logger );
		} else {
			for ( const outcome of result.sites ) {
				const fileSummary =
					outcome.filePaths && outcome.filePaths.length > 0
						? outcome.filePaths.join( ', ' )
						: __( 'no files' );
				logger.reportSuccess(
					sprintf(
						// translators: 1: site name, 2: site path, 3: file paths that would be moved to Trash
						__( 'Would delete %1$s (%2$s); files: %3$s' ),
						outcome.name ?? outcome.identity,
						outcome.path ?? outcome.identity,
						fileSummary
					)
				);
			}
		}

		return result;
	}

	const outcomes: DeleteSiteOutcome[] = [];

	try {
		await withSiteOperations(
			resolved.map( ( item ) => item.site.id ),
			'delete',
			async () => {
				try {
					logger.reportStart( LoggerAction.START_DAEMON, __( 'Starting process daemon…' ) );
					await connectToDaemon();
					logger.reportSuccess( __( 'Process daemon started' ) );

					for ( const item of resolved ) {
						try {
							const warnings = await deleteSite( item.site, item.filePaths, deleteFiles, logger );
							outcomes.push( outcomeForSite( item, 'deleted', undefined, warnings ) );
						} catch ( error ) {
							const message = error instanceof Error ? error.message : String( error );
							logger.reportError( new LoggerError( message, error ), false );
							outcomes.push( outcomeForSite( item, 'failed', message ) );
						}
					}
				} finally {
					await disconnectFromDaemon();
				}
			}
		);
	} catch ( error ) {
		if ( outcomes.length === 0 && resolved.length > 0 ) {
			const message = error instanceof Error ? error.message : String( error );
			const [ first, ...rest ] = resolved;
			outcomes.push( outcomeForSite( first, 'failed', message ) );
			outcomes.push(
				...rest.map( ( item ) =>
					outcomeForSite( item, 'skipped', __( 'Skipped because the batch could not start.' ) )
				)
			);
		} else if ( throwOnFailure ) {
			throw error;
		}
	}

	const result: DeleteCommandResult = {
		dryRun: false,
		deleteFiles,
		sites: outcomes,
	};

	if ( outcomes.some( ( outcome ) => outcome.status === 'failed' ) ) {
		return finishWithFailures( result, { format, throwOnFailure, logger } );
	}

	if ( format === 'json' ) {
		emitMachineOutput( result, logger );
	} else if ( resolved.length > 1 ) {
		const deletedCount = outcomes.filter( ( outcome ) => outcome.status === 'deleted' ).length;
		logger.reportSuccess(
			sprintf( _n( 'Deleted %d site', 'Deleted %d sites', deletedCount ), deletedCount )
		);
	}

	return result;
}

async function deleteSite(
	site: SiteData,
	filePaths: string[],
	deleteFiles: boolean,
	logger: Logger< LoggerAction >
): Promise< string[] > {
	const warnings: string[] = [];
	const runningProcess = await isServerRunning( site.id );
	if ( runningProcess ) {
		logger.reportStart( LoggerAction.STOP_SITE, __( 'Stopping WordPress server…' ) );
		await stopWordPressServer( site.id );
		logger.reportSuccess( __( 'WordPress server stopped' ) );
		await stopProxyIfNoSitesNeedIt( site.id, logger );
	}

	if ( site.customDomain ) {
		logger.reportStart(
			LoggerAction.REMOVE_DOMAIN_FROM_HOSTS,
			__( 'Removing domain from hosts file…' )
		);
		await removeDomainFromHosts( site.customDomain );
		logger.reportSuccess( __( 'Domain removed from hosts file' ) );

		if ( site.enableHttps ) {
			logger.reportStart( LoggerAction.DELETE_CERT, __( 'Deleting SSL certificates…' ) );
			deleteSiteCertificate( site.customDomain );
			logger.reportSuccess( __( 'SSL certificates deleted' ) );
		}
	}

	const authToken = await readAuthToken();
	if ( authToken ) {
		await deletePreviewSites( authToken, site.path, logger );
	}

	try {
		await lockCliConfig();
		const cliConfig = await readCliConfig();
		const siteIndex = cliConfig.sites.findIndex( ( s ) => arePathsEqual( s.path, site.path ) );
		if ( siteIndex === -1 ) {
			throw new LoggerError( __( 'The specified directory is not added to Studio.' ) );
		}
		cliConfig.sites.splice( siteIndex, 1 );
		await saveCliConfig( cliConfig );
	} finally {
		await unlockCliConfig();
	}

	try {
		await removeAllConnectedWpcomSitesForLocalSite( site.id );
	} catch ( error ) {
		logger.reportError(
			new LoggerError(
				__( 'Failed to remove WordPress.com connections. Proceeding anyway…' ),
				error
			),
			false
		);
	}

	try {
		await deleteAiSessionsForSite( getSessionsDirectory(), {
			id: site.id,
			path: site.path,
		} );
	} catch ( error ) {
		logger.reportError(
			new LoggerError( __( 'Failed to delete chat sessions. Proceeding anyway…' ), error ),
			false
		);
	}

	if ( deleteFiles ) {
		// Imported sites have both a visible site directory and a
		// hidden technical directory under ~/.studio/imports; delete
		// both if they exist.
		if ( filePaths.length > 0 ) {
			logger.reportStart( LoggerAction.DELETE_FILES, __( 'Moving site files to trash…' ) );
			// The site is already out of the config by this point, so a trash failure must not
			// abort the rest of the delete — otherwise the DELETED event never fires and the UI
			// keeps showing a site that no longer exists.
			try {
				await trash( filePaths );
				logger.reportSuccess( __( 'Site files moved to trash' ) );
			} catch ( error ) {
				// `reportError` with `isFatal: false` leaves the exit code at 0, and the desktop app
				// only surfaces CLI IPC failures for non-zero exits, so log to stderr as well.
				console.error( 'Failed to move site files to trash:', error );
				const failure = new LoggerError(
					__( 'Failed to move site files to trash. Proceeding anyway…' ),
					error
				);
				warnings.push( failure.message );
				logger.reportError( failure, false );
			}
		} else {
			logger.reportSuccess( __( 'Site files already removed' ) );
		}
	}

	await emitCliEvent( { event: SITE_EVENTS.DELETED, data: { siteId: site.id } } );

	// Tracks: the CLI is the sole emitter of site-delete, whether deleted standalone or by the
	// desktop app (which delegates to `site delete` and passes its origin via STUDIO_TRACKS_ORIGIN).
	// Best-effort — wrapped so telemetry can never fail a delete.
	try {
		await recordTracksEvent( TRACKS_EVENTS.SITE_DELETE, {
			...getTracksOrigin(),
			delete_files: deleteFiles,
		} );
	} catch {
		// Best-effort telemetry — never block or fail a delete.
	}

	return warnings;
}

function collectIdentities( argv: { sites?: string | string[]; path: string } ): string[] {
	if ( Array.isArray( argv.sites ) && argv.sites.length > 0 ) {
		return argv.sites;
	}

	if ( typeof argv.sites === 'string' && argv.sites.length > 0 ) {
		return [ argv.sites ];
	}

	return [ argv.path ];
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'delete [sites..]',
		describe: __( 'Delete site' ),
		builder: ( yargs ) => {
			return yargs
				.positional( 'sites', {
					type: 'string',
					array: true,
					description: __( 'Site paths or IDs to delete' ),
				} )
				.option( 'files', {
					type: 'boolean',
					description: __( 'Move site files to trash (use --no-files to keep files)' ),
					default: true,
				} )
				.option( 'dry-run', {
					alias: 'preview',
					type: 'boolean',
					description: __( 'Show which sites and files would be deleted without deleting them' ),
					default: false,
				} )
				.option( 'format', {
					type: 'string',
					choices: [ 'text', 'json' ] as const,
					default: 'text' as const,
					description: __( 'Output format' ),
				} );
		},
		handler: async ( argv ) => {
			try {
				await runDeleteCommand( {
					identities: collectIdentities( argv ),
					deleteFiles: argv.files,
					dryRun: argv.dryRun,
					format: argv.format,
				} );
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					defaultLogger.reportError( error );
				} else {
					const loggerError = new LoggerError( __( 'Failed to delete site' ), error );
					defaultLogger.reportError( loggerError );
				}
			}
		},
	} );
};
