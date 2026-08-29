import fs from 'fs';
import path from 'path';
import { deleteAiSessionsForSite } from '@studio/common/ai/sessions/manage';
import { SITE_EVENTS } from '@studio/common/lib/cli-events';
import { removeAllConnectedWpcomSitesForLocalSite } from '@studio/common/lib/connected-sites';
import { arePathsEqual } from '@studio/common/lib/fs-utils';
import { readAuthToken, type StoredAuthToken } from '@studio/common/lib/shared-config';
import { getSessionsDirectory } from '@studio/common/lib/well-known-paths';
import { SiteCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, _n, sprintf } from '@wordpress/i18n';
import CliTable3 from 'cli-table3';
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
import { findSiteById, getSiteByFolder } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon, emitCliEvent } from 'cli/lib/daemon-client';
import { removeDomainFromHosts } from 'cli/lib/hosts-file';
import { withSiteOperation } from 'cli/lib/site-operations';
import { stopProxyIfNoSitesNeedIt } from 'cli/lib/site-utils';
import { getSnapshotsFromConfig, deleteSnapshotFromConfig } from 'cli/lib/snapshots';
import { getTracksOrigin, recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';
import { getColumnWidths, getPrettyPath, untildify } from 'cli/lib/utils';
import { isServerRunning, stopWordPressServer } from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const defaultLogger = new Logger< LoggerAction >();

export type DeleteSiteStatus = 'deleted' | 'skipped' | 'failed';

export type DeleteSiteOutcome = {
	identity: string;
	status: DeleteSiteStatus;
	id?: string;
	name?: string;
	path?: string;
	files?: string[];
	error?: string;
};

export type DeleteRunOptions = {
	dryRun?: boolean;
	format?: 'table' | 'json';
};

type DeleteIdentityArgv = {
	path: string;
	id?: Array< string | number > | string | number;
	sites?: Array< string | number > | string | number;
};

function toIdentityList(
	value: DeleteIdentityArgv[ 'id' ] | DeleteIdentityArgv[ 'sites' ]
): string[] {
	if ( value === undefined || value === null ) {
		return [];
	}

	return ( Array.isArray( value ) ? value : [ value ] ).map( String ).filter( Boolean );
}

export function isPathFlagProvided( argv: readonly string[] = process.argv ): boolean {
	return argv.some( ( arg ) => arg === '--path' || arg === '-p' || arg.startsWith( '--path=' ) );
}

export function collectDeleteIdentities( argv: DeleteIdentityArgv ): string[] {
	const identities = [ ...toIdentityList( argv.id ), ...toIdentityList( argv.sites ) ];
	if ( identities.length === 0 || isPathFlagProvided() ) {
		identities.unshift( argv.path );
	}
	return identities;
}

function normalizeIdentities( identities: string | readonly string[] ): string[] {
	return ( Array.isArray( identities ) ? [ ...identities ] : [ identities ] )
		.map( ( identity ) => identity.trim() )
		.filter( Boolean );
}

async function resolveSiteIdentity( identity: string ): Promise< SiteData > {
	const siteById = await findSiteById( identity );
	if ( siteById ) {
		return siteById;
	}

	return getSiteByFolder( path.resolve( untildify( identity ) ) );
}

function getDeleteFileTargets( site: SiteData, deleteFiles: boolean ): string[] {
	if ( ! deleteFiles ) {
		return [];
	}

	return [ site.path, site.technicalSiteDirectory ].filter(
		( value ): value is string => typeof value === 'string' && fs.existsSync( value )
	);
}

function outcomeFromSite(
	identity: string,
	status: DeleteSiteStatus,
	site: SiteData,
	files: string[],
	error?: string
): DeleteSiteOutcome {
	return {
		identity,
		status,
		id: site.id,
		name: site.name,
		path: site.path,
		files,
		...( error ? { error } : {} ),
	};
}

function errorMessage( error: unknown ): string {
	return error instanceof Error ? error.message : String( error );
}

function emitOutcomes(
	outcomes: DeleteSiteOutcome[],
	format: 'table' | 'json',
	logger: Logger< LoggerAction >
): void {
	const json = JSON.stringify( outcomes );
	logger.reportKeyValuePair( 'results', json );

	if ( format === 'json' ) {
		console.log( json );
		return;
	}

	if ( outcomes.length === 0 ) {
		return;
	}

	const colWidths = getColumnWidths( [ 0.15, 0.2, 0.25, 0.4 ] );
	const table = new CliTable3( {
		head: [ __( 'Status' ), __( 'Name' ), __( 'Path' ), __( 'Files' ) ],
		wordWrap: true,
		wrapOnWordBoundary: false,
		colWidths,
		style: {
			head: [],
			border: [],
		},
	} );

	const statusLabel = ( status: DeleteSiteStatus ): string => {
		switch ( status ) {
			case 'deleted':
				return __( 'Deleted' );
			case 'skipped':
				return __( 'Skipped' );
			case 'failed':
				return __( 'Failed' );
		}
	};

	table.push(
		...outcomes.map( ( outcome ) => [
			statusLabel( outcome.status ),
			outcome.name ?? outcome.identity,
			outcome.path ? getPrettyPath( outcome.path ) : outcome.identity,
			( outcome.files ?? [] ).map( getPrettyPath ).join( '\n' ),
		] )
	);

	console.log( table.toString() );
}

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

async function deleteSite(
	siteFolder: string,
	deleteFiles: boolean,
	logger: Logger< LoggerAction >
): Promise< void > {
	logger.reportStart( LoggerAction.LOAD_SITES, __( 'Loading site…' ) );
	const site = await getSiteByFolder( siteFolder );
	logger.reportSuccess( __( 'Site loaded' ) );

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
		await deletePreviewSites( authToken, siteFolder, logger );
	}

	try {
		await lockCliConfig();
		const cliConfig = await readCliConfig();
		const siteIndex = cliConfig.sites.findIndex( ( s ) => arePathsEqual( s.path, siteFolder ) );
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
		const deleteTargets = getDeleteFileTargets( site, true );

		if ( deleteTargets.length > 0 ) {
			logger.reportStart( LoggerAction.DELETE_FILES, __( 'Moving site files to trash…' ) );
			await trash( deleteTargets );
			logger.reportSuccess( __( 'Site files moved to trash' ) );
		} else {
			logger.reportSuccess( __( 'Site files already removed' ) );
		}
	}

	await emitCliEvent( { event: SITE_EVENTS.DELETED, data: { siteId: site.id } } );

	try {
		await recordTracksEvent( TRACKS_EVENTS.SITE_DELETE, {
			...getTracksOrigin(),
			delete_files: deleteFiles,
		} );
	} catch {
		// Best-effort telemetry — never block or fail a delete.
	}
}

export async function runCommand(
	identities: string | readonly string[],
	deleteFiles: boolean = true,
	logger: Logger< LoggerAction > = defaultLogger,
	options: DeleteRunOptions = {}
): Promise< DeleteSiteOutcome[] > {
	const commandLogger = logger ?? defaultLogger;
	const format = options.format ?? 'table';
	const requested = normalizeIdentities( identities );
	if ( requested.length === 0 ) {
		throw new LoggerError( __( 'No sites specified.' ) );
	}

	commandLogger.reportStart(
		LoggerAction.LOAD_SITES,
		sprintf( _n( 'Resolving %d site…', 'Resolving %d sites…', requested.length ), requested.length )
	);

	type ResolvedIdentity =
		| { identity: string; site: SiteData; files: string[]; duplicate: false }
		| { identity: string; site: SiteData; files: string[]; duplicate: true }
		| { identity: string; site?: undefined; files?: undefined; error: string };

	const seenIds = new Set< string >();
	const resolved: ResolvedIdentity[] = [];

	for ( const identity of requested ) {
		try {
			const site = await resolveSiteIdentity( identity );
			const files = getDeleteFileTargets( site, deleteFiles );
			if ( seenIds.has( site.id ) ) {
				resolved.push( { identity, site, files, duplicate: true } );
				continue;
			}
			seenIds.add( site.id );
			resolved.push( { identity, site, files, duplicate: false } );
		} catch ( error ) {
			resolved.push( { identity, error: errorMessage( error ) } );
		}
	}

	const pending = resolved.filter(
		( item ): item is { identity: string; site: SiteData; files: string[]; duplicate: false } =>
			item.site !== undefined && item.duplicate === false
	);

	commandLogger.reportSuccess(
		sprintf( _n( 'Resolved %d site', 'Resolved %d sites', pending.length ), pending.length )
	);

	const toOutcome = ( item: ResolvedIdentity, status: DeleteSiteStatus ): DeleteSiteOutcome => {
		if ( ! item.site ) {
			return { identity: item.identity, status: 'failed', error: item.error };
		}
		if ( item.duplicate ) {
			return outcomeFromSite(
				item.identity,
				'skipped',
				item.site,
				item.files,
				__( 'Already selected' )
			);
		}
		return outcomeFromSite( item.identity, status, item.site, item.files );
	};

	if ( options.dryRun ) {
		const previewOutcomes = resolved.map( ( item ) =>
			toOutcome( item, item.site && ! item.duplicate ? 'skipped' : 'failed' )
		);
		emitOutcomes( previewOutcomes, format, commandLogger );
		return previewOutcomes;
	}

	const shouldEmit = format === 'json' || requested.length > 1;
	const unresolved = resolved.filter( ( item ) => ! item.site );

	if ( pending.length === 0 || unresolved.length > 0 ) {
		const failedOutcomes = resolved.map( ( item ) => {
			if ( ! item.site || item.duplicate ) {
				return toOutcome( item, 'failed' );
			}
			return outcomeFromSite(
				item.identity,
				'skipped',
				item.site,
				item.files,
				__( 'Skipped because the requested set could not be fully resolved' )
			);
		} );
		if ( shouldEmit ) {
			emitOutcomes( failedOutcomes, format, commandLogger );
		}
		if ( requested.length === 1 && failedOutcomes[ 0 ]?.error ) {
			throw new LoggerError( failedOutcomes[ 0 ].error );
		}
		throw new LoggerError( __( 'Failed to delete one or more sites' ) );
	}

	try {
		commandLogger.reportStart( LoggerAction.START_DAEMON, __( 'Starting process daemon…' ) );
		await connectToDaemon();
		commandLogger.reportSuccess( __( 'Process daemon started' ) );

		const mutationByIdentity = new Map< string, DeleteSiteOutcome >();
		let firstMutationError: unknown;

		for ( const item of pending ) {
			try {
				await withSiteOperation( item.site.path, 'delete', () =>
					deleteSite( item.site.path, deleteFiles, commandLogger )
				);
				mutationByIdentity.set(
					item.identity,
					outcomeFromSite( item.identity, 'deleted', item.site, item.files )
				);
			} catch ( error ) {
				if ( firstMutationError === undefined ) {
					firstMutationError = error;
				}
				mutationByIdentity.set(
					item.identity,
					outcomeFromSite( item.identity, 'failed', item.site, item.files, errorMessage( error ) )
				);
			}
		}

		const orderedOutcomes = resolved.map( ( item ) => {
			if ( item.site && ! item.duplicate ) {
				return (
					mutationByIdentity.get( item.identity ) ??
					outcomeFromSite( item.identity, 'failed', item.site, item.files )
				);
			}
			return toOutcome( item, 'failed' );
		} );

		if ( shouldEmit ) {
			emitOutcomes( orderedOutcomes, format, commandLogger );
		}

		if ( orderedOutcomes.some( ( outcome ) => outcome.status === 'failed' ) ) {
			if ( requested.length === 1 && firstMutationError ) {
				throw firstMutationError;
			}
			throw new LoggerError( __( 'Failed to delete one or more sites' ) );
		}

		return orderedOutcomes;
	} finally {
		await disconnectFromDaemon();
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'delete [sites..]',
		describe: __( 'Delete site(s)' ),
		builder: ( yargs ) => {
			return yargs
				.positional( 'sites', {
					describe: __( 'Site paths or IDs' ),
					type: 'string',
					array: true,
				} )
				.option( 'id', {
					type: 'array',
					string: true,
					description: __( 'Site ID(s) to delete' ),
				} )
				.option( 'files', {
					type: 'boolean',
					description: __( 'Move site files to trash (use --no-files to keep files)' ),
					default: true,
				} )
				.option( 'dry-run', {
					type: 'boolean',
					description: __( 'Preview selected sites and file paths without deleting' ),
					default: false,
				} )
				.option( 'format', {
					type: 'string',
					choices: [ 'table', 'json' ] as const,
					default: 'table' as const,
					description: __( 'Output format' ),
				} );
		},
		handler: async ( argv ) => {
			try {
				await runCommand( collectDeleteIdentities( argv ), argv.files, defaultLogger, {
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
