import path from 'path';
import { DEFAULT_PHP_VERSION } from '@studio/common/constants';
import { SiteCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, _n, sprintf } from '@wordpress/i18n';
import { getSiteByFolder } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { ExportEvents } from 'cli/lib/import-export/export/events';
import { exportBackup } from 'cli/lib/import-export/export/export-manager';
import { BackupCreateProgressEventData, ExportOptions } from 'cli/lib/import-export/export/types';
import { ImportExportEventData } from 'cli/lib/import-export/handle-events';
import { keepSqliteIntegrationUpdated } from 'cli/lib/sqlite-integration';
import { untildify } from 'cli/lib/utils';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< LoggerAction >();

export function exportEventHandler( { event, data }: ImportExportEventData ): void {
	switch ( event ) {
		case ExportEvents.EXPORT_START:
			logger.reportStart( LoggerAction.EXPORT_SITE, __( 'Starting export…' ) );
			break;

		case ExportEvents.BACKUP_CREATE_START:
			logger.reportStart( LoggerAction.CREATE_BACKUP, __( 'Creating backup file…' ) );
			break;

		case ExportEvents.WP_CONTENT_EXPORT_START:
			logger.reportStart( LoggerAction.EXPORT_WP_CONTENT, __( 'Traversing WordPress content…' ) );
			break;
		case ExportEvents.WP_CONTENT_EXPORT_COMPLETE:
			logger.reportSuccess( __( 'WordPress content traversed' ) );
			break;

		case ExportEvents.DATABASE_EXPORT_START:
			logger.reportStart( LoggerAction.EXPORT_DATABASE, __( 'Exporting database…' ) );
			break;
		case ExportEvents.DATABASE_EXPORT_COMPLETE:
			logger.reportSuccess( __( 'Database exported' ) );
			break;

		case ExportEvents.BACKUP_CREATE_PROGRESS: {
			const progressData = data as BackupCreateProgressEventData;
			const processed = progressData?.progress?.entries?.processed;

			if ( processed != null ) {
				logger.reportProgress(
					sprintf(
						_n( 'Backing up file… (%d processed)', 'Backing up files… (%d processed)', processed ),
						processed
					)
				);
			}
			break;
		}
		case ExportEvents.BACKUP_CREATE_COMPLETE:
			logger.reportSuccess( __( 'Backup file created' ) );
			break;

		case ExportEvents.CONFIG_EXPORT_START:
			logger.reportStart( LoggerAction.EXPORT_CONFIG, __( 'Exporting configuration…' ) );
			break;
		case ExportEvents.CONFIG_EXPORT_COMPLETE:
			logger.reportSuccess( __( 'Configuration exported' ) );
			break;

		case ExportEvents.EXPORT_COMPLETE:
			logger.reportSuccess( __( 'Site exported successfully' ) );
			break;

		case ExportEvents.EXPORT_ERROR:
			throw new LoggerError( __( 'Export failed' ), data instanceof Error ? data : undefined );
	}
}

export async function runCommand(
	siteFolder: string,
	exportPath: string,
	includeOnly?: 'content' | 'db'
): Promise< void > {
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

		if ( includeOnly === 'content' ) {
			includes.database = false;
		} else if ( includeOnly === 'db' ) {
			includes.wpContent = false;
		}

		const isExported = await exportBackup(
			{
				site,
				backupFile: exportPath,
				phpVersion: DEFAULT_PHP_VERSION,
				includes,
			},
			exportEventHandler
		);

		if ( ! isExported ) {
			throw new LoggerError( __( 'No suitable exporter found for the provided backup file' ) );
		}
	} finally {
		await disconnectFromDaemon();
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'export <export-file>',
		describe: __( 'Export site to a backup file' ),
		builder: ( yargs ) => {
			return yargs
				.positional( 'export-file', {
					type: 'string',
					normalize: true,
					demandOption: true,
					description: __( 'Path to the export file. Can be a .zip, .tar.gz or .sql file.' ),
					coerce: ( value ) => {
						return path.resolve( untildify( value ) );
					},
				} )
				.option( 'only', {
					type: 'string',
					choices: [ 'content', 'db' ] as const,
					description: __( 'Export only the content or the database' ),
				} );
		},
		handler: async ( argv ) => {
			try {
				if ( argv.only === 'content' && argv.exportFile.endsWith( '.sql' ) ) {
					throw new LoggerError(
						__(
							'Invalid export file extension. Must be .zip or .tar.gz when exporting site content.'
						)
					);
				}

				if (
					! argv.exportFile.endsWith( '.sql' ) &&
					! argv.exportFile.endsWith( '.zip' ) &&
					! argv.exportFile.endsWith( '.tar.gz' )
				) {
					throw new LoggerError(
						__( 'Invalid export file extension. Must be .zip, .tar.gz or .sql.' )
					);
				}

				await runCommand( argv.path, argv.exportFile, argv.only );
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
