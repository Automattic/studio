import path from 'path';
import { DEFAULT_PHP_VERSION } from '@studio/common/constants';
import { createDeployIgnoreFilter } from '@studio/common/lib/deploy-ignore';
import { ExportEvents, ExportIpcEvent } from '@studio/common/lib/import-export-events';
import { SYNC_IGNORE_DEFAULTS } from '@studio/common/lib/sync/constants';
import { SiteCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, _n, sprintf } from '@wordpress/i18n';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { ImportExportEventEmitter } from 'cli/lib/import-export/events';
import { getExporter } from 'cli/lib/import-export/export/export-manager';
import { ExportOptions } from 'cli/lib/import-export/export/types';
import { keepSqliteIntegrationUpdated } from 'cli/lib/sqlite-integration';
import { getTracksOrigin, recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';
import { classifyExportFailure, untildify } from 'cli/lib/utils';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< LoggerAction >();

function sendIpcEvent( eventTuple: ExportIpcEvent[ 'event' ] ) {
	const ipcEvent: ExportIpcEvent = { event: eventTuple };
	process.send!( ipcEvent );
}

function handleExportIpc( emitter: ImportExportEventEmitter ) {
	emitter.on( ExportEvents.EXPORT_START, () => {
		sendIpcEvent( [ ExportEvents.EXPORT_START, undefined ] );
	} );
	emitter.on( ExportEvents.BACKUP_CREATE_START, () => {
		sendIpcEvent( [ ExportEvents.BACKUP_CREATE_START, undefined ] );
	} );
	emitter.on( ExportEvents.WP_CONTENT_EXPORT_START, () => {
		sendIpcEvent( [ ExportEvents.WP_CONTENT_EXPORT_START, undefined ] );
	} );
	emitter.on( ExportEvents.WP_CONTENT_EXPORT_COMPLETE, () => {
		sendIpcEvent( [ ExportEvents.WP_CONTENT_EXPORT_COMPLETE, undefined ] );
	} );
	emitter.on( ExportEvents.DATABASE_EXPORT_START, () => {
		sendIpcEvent( [ ExportEvents.DATABASE_EXPORT_START, undefined ] );
	} );
	emitter.on( ExportEvents.DATABASE_EXPORT_COMPLETE, () => {
		sendIpcEvent( [ ExportEvents.DATABASE_EXPORT_COMPLETE, undefined ] );
	} );
	emitter.on( ExportEvents.BACKUP_CREATE_PROGRESS, ( progressData ) => {
		sendIpcEvent( [ ExportEvents.BACKUP_CREATE_PROGRESS, progressData ] );
	} );
	emitter.on( ExportEvents.BACKUP_CREATE_COMPLETE, () => {
		sendIpcEvent( [ ExportEvents.BACKUP_CREATE_COMPLETE, undefined ] );
	} );
	emitter.on( ExportEvents.CONFIG_EXPORT_START, () => {
		sendIpcEvent( [ ExportEvents.CONFIG_EXPORT_START, undefined ] );
	} );
	emitter.on( ExportEvents.CONFIG_EXPORT_COMPLETE, () => {
		sendIpcEvent( [ ExportEvents.CONFIG_EXPORT_COMPLETE, undefined ] );
	} );
	emitter.on( ExportEvents.EXPORT_COMPLETE, () => {
		sendIpcEvent( [ ExportEvents.EXPORT_COMPLETE, undefined ] );
	} );
	emitter.on( ExportEvents.EXPORT_ERROR, ( payload ) => {
		sendIpcEvent( [ ExportEvents.EXPORT_ERROR, payload ] );
	} );
}

export function handleExportEvents( emitter: ImportExportEventEmitter ): void {
	emitter.on( ExportEvents.EXPORT_START, () => {
		logger.reportStart( LoggerAction.EXPORT_SITE, __( 'Starting export…' ) );
	} );

	emitter.on( ExportEvents.BACKUP_CREATE_START, () => {
		logger.reportStart( LoggerAction.CREATE_BACKUP, __( 'Creating backup file…' ) );
	} );

	emitter.on( ExportEvents.WP_CONTENT_EXPORT_START, () => {
		logger.reportStart( LoggerAction.EXPORT_WP_CONTENT, __( 'Traversing WordPress content…' ) );
	} );

	emitter.on( ExportEvents.WP_CONTENT_EXPORT_COMPLETE, () => {
		logger.reportSuccess( __( 'WordPress content traversed' ) );
	} );

	emitter.on( ExportEvents.DATABASE_EXPORT_START, () => {
		logger.reportStart( LoggerAction.EXPORT_DATABASE, __( 'Exporting database…' ) );
	} );

	emitter.on( ExportEvents.DATABASE_EXPORT_COMPLETE, () => {
		logger.reportSuccess( __( 'Database exported' ) );
	} );

	emitter.on( ExportEvents.BACKUP_CREATE_PROGRESS, ( progressData ) => {
		const processed = progressData.progress.entries.processed;
		logger.reportProgress(
			sprintf(
				_n( 'Backing up file… (%d processed)', 'Backing up files… (%d processed)', processed ),
				processed
			)
		);
	} );

	emitter.on( ExportEvents.BACKUP_CREATE_COMPLETE, () => {
		logger.reportSuccess( __( 'Backup file created' ) );
	} );

	emitter.on( ExportEvents.CONFIG_EXPORT_START, () => {
		logger.reportStart( LoggerAction.EXPORT_CONFIG, __( 'Exporting configuration…' ) );
	} );

	emitter.on( ExportEvents.CONFIG_EXPORT_COMPLETE, () => {
		logger.reportSuccess( __( 'Configuration exported' ) );
	} );

	emitter.on( ExportEvents.EXPORT_COMPLETE, () => {
		logger.reportSuccess( __( 'Site exported successfully' ) );
	} );

	// No EXPORT_ERROR handler: every emitter rethrows the original error right after emitting, and
	// that error carries the failure `code` for analytics — a wrap here would discard it.
}

export async function runCommand(
	siteFolder: string,
	exportPath: string,
	mode: 'full' | 'content' | 'db' = 'full',
	splitDbDumpByTable = false,
	includeOnlyPaths?: string[],
	applyDeployIgnore = false,
	suppressTracksEvent = false
): Promise< void > {
	const startedAt = Date.now();
	try {
		logger.reportStart( LoggerAction.START_DAEMON, __( 'Starting process daemon…' ) );
		await connectToDaemon();
		logger.reportSuccess( __( 'Process daemon started' ) );

		logger.reportStart( LoggerAction.LOAD_SITES, __( 'Loading site…' ) );
		const site = await getSiteByFolder( siteFolder );
		logger.reportSuccess( __( 'Site loaded' ) );

		logger.reportStart(
			LoggerAction.INSTALL_SQLITE,
			__( 'Setting up SQLite integration, if needed…' )
		);
		await keepSqliteIntegrationUpdated( siteFolder );
		logger.reportSuccess( __( 'SQLite integration configured as needed' ) );

		const includes: ExportOptions[ 'includes' ] = { database: true, wpContent: true };

		if ( mode === 'db' ) {
			includes.wpContent = false;
		} else if ( mode === 'content' ) {
			includes.database = false;
		}

		const ignoreFilter = applyDeployIgnore
			? await createDeployIgnoreFilter( site.path, SYNC_IGNORE_DEFAULTS )
			: undefined;

		const exporter = await getExporter( {
			site,
			backupFile: exportPath,
			phpVersion: DEFAULT_PHP_VERSION,
			includes,
			splitDatabaseDumpByTable: splitDbDumpByTable,
			specificSelectionPaths: includeOnlyPaths,
			ignoreFilter,
		} );

		if ( ! exporter ) {
			throw new LoggerError(
				__( 'No suitable exporter found for the provided backup file' ),
				undefined,
				'no_exporter_found'
			);
		}

		if ( process.send ) {
			handleExportIpc( exporter );
		} else {
			handleExportEvents( exporter );
		}
		await exporter.export();

		logger.reportSuccess( sprintf( __( '%s successfully exported' ), exportPath ) );

		if ( ! suppressTracksEvent ) {
			await recordSiteExportEvent( {
				success: true,
				export_type: mode,
				time_ms: Date.now() - startedAt,
			} );
		}
	} catch ( error ) {
		if ( ! suppressTracksEvent ) {
			await recordSiteExportEvent( {
				success: false,
				export_type: mode,
				failure_reason: classifyExportFailure( error ),
				time_ms: Date.now() - startedAt,
			} );
		}
		throw error;
	} finally {
		await disconnectFromDaemon();
	}
}

async function recordSiteExportEvent( props: {
	success: boolean;
	export_type: 'full' | 'content' | 'db';
	failure_reason?: string;
	time_ms: number;
} ): Promise< void > {
	try {
		await recordTracksEvent( TRACKS_EVENTS.SITE_EXPORT, {
			...props,
			...getTracksOrigin(),
		} );
	} catch {
		// Best-effort telemetry — never block or fail the export.
	}
}

function getTimestamp( date = new Date() ): string {
	return [
		date.getFullYear(),
		date.getMonth() + 1,
		date.getDate(),
		date.getHours(),
		date.getMinutes(),
		date.getSeconds(),
	]
		.map( ( part ) => String( part ).padStart( 2, '0' ) )
		.join( '-' );
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'export [export-file]',
		describe: __( 'Export site to a backup file' ),
		builder: ( yargs ) => {
			return yargs
				.positional( 'export-file', {
					type: 'string',
					normalize: true,
					demandOption: false,
					description: __(
						'Path to the export file. All exports can use .zip or .tar.gz. Database-only exports can also use .sql.'
					),
					coerce: ( value ) => {
						return path.resolve( untildify( value ) );
					},
				} )
				.option( 'mode', {
					type: 'string',
					choices: [ 'full', 'content', 'db' ] as const,
					default: 'full' as const,
					description: __(
						'Export the full site, just the content, or just the database. Default exports full site.'
					),
				} )
				.option( 'split-db-dump-by-table', {
					type: 'boolean',
					default: false,
					description: __( 'Split the database dump by table' ),
					hidden: true,
				} )
				.option( 'include-only', {
					type: 'array',
					description: __( 'Include only the specified paths in the export' ),
					coerce: ( value ) => {
						if ( ! Array.isArray( value ) ) {
							throw new Error( __( 'include-only must be an array' ) );
						}
						return value.map( String );
					},
					hidden: true,
				} )
				.option( 'apply-deploy-ignore', {
					type: 'boolean',
					default: false,
					description: __( 'Apply .deployignore patterns when exporting' ),
					hidden: true,
				} )
				.option( 'suppress-tracks-event', {
					type: 'boolean',
					default: false,
					hidden: true,
				} );
		},
		handler: async ( argv ) => {
			try {
				let exportFile: string;
				const timestamp = getTimestamp();

				if ( argv.exportFile ) {
					exportFile = argv.exportFile;
				} else if ( argv.mode === 'full' || argv.mode === 'content' ) {
					exportFile = path.join( process.cwd(), `studio-backup-${ timestamp }.zip` );
				} else {
					exportFile = path.join( process.cwd(), `studio-backup-${ timestamp }.sql` );
				}

				if (
					( argv.mode === 'full' || argv.mode === 'content' ) &&
					! exportFile.endsWith( '.zip' ) &&
					! exportFile.endsWith( '.tar.gz' )
				) {
					throw new LoggerError(
						__(
							'Invalid export file extension. Must be .zip or .tar.gz when exporting the full site.'
						)
					);
				}

				await runCommand(
					argv.path,
					exportFile,
					argv.mode,
					argv.splitDbDumpByTable,
					argv.includeOnly,
					argv.applyDeployIgnore,
					argv.suppressTracksEvent
				);
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					const loggerError = new LoggerError( __( 'Failed to export site' ), error );
					logger.reportError( loggerError );
				}
			}
		},
	} );
};
