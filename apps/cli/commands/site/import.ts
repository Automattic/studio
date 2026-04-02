import fs from 'fs';
import path from 'path';
import { isWordPressDirectory, recursiveCopyDirectory } from '@studio/common/lib/fs-utils';
import { getServerFilesPath } from '@studio/common/lib/well-known-paths';
import { SiteCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, _n, sprintf } from '@wordpress/i18n';
import { SiteData } from 'cli/lib/cli-config/core';
import { clearSiteLatestCliPid, getSiteByFolder, getSiteUrl } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { ImportExportEventData } from 'cli/lib/import-export/handle-events';
import {
	BackupExtractEvents,
	ImporterEvents,
	ValidatorEvents,
} from 'cli/lib/import-export/import/events';
import {
	DEFAULT_IMPORTER_OPTIONS,
	importBackup,
} from 'cli/lib/import-export/import/import-manager';
import {
	BackupExtractProgressEventData,
	ImportDatabaseProgressEventData,
	ImportWpContentProgressEventData,
} from 'cli/lib/import-export/import/types';
import { getBackupFileType } from 'cli/lib/import-export/utils';
import { keepSqliteIntegrationUpdated } from 'cli/lib/sqlite-integration';
import { untildify } from 'cli/lib/utils';
import {
	isServerRunning,
	startWordPressServer,
	stopWordPressServer,
} from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< LoggerAction >();

const WP_CONTENT_TYPE_LABELS: Record< string, string > = {
	plugins: __( 'Importing plugins…' ),
	themes: __( 'Importing themes…' ),
	uploads: __( 'Importing media uploads…' ),
	other: __( 'Importing other files…' ),
};

async function setupWordPressFilesOnly( sitePath: string ): Promise< void > {
	const bundledWpPath = path.join( getServerFilesPath(), 'wordpress-versions', 'latest' );

	if ( ! fs.existsSync( bundledWpPath ) ) {
		throw new LoggerError(
			__(
				'Cannot set up WordPress. Bundled WordPress files not found. Please connect to the internet or reinstall Studio.'
			)
		);
	}

	await recursiveCopyDirectory( bundledWpPath, sitePath );
}

export function importEventHandler( { event, data }: ImportExportEventData ): void {
	switch ( event ) {
		case ValidatorEvents.IMPORT_VALIDATION_START:
			logger.reportSuccess( sprintf( __( 'Started import…' ) ) );
			logger.reportStart( LoggerAction.VALIDATE, __( 'Validating backup…' ) );
			break;
		case ValidatorEvents.IMPORT_VALIDATION_COMPLETE:
			logger.reportSuccess( __( 'Backup validated' ) );
			break;
		case ValidatorEvents.IMPORT_VALIDATION_ERROR:
			throw new LoggerError(
				__( 'Backup validation failed' ),
				data instanceof Error ? data : undefined
			);

		case BackupExtractEvents.BACKUP_EXTRACT_START:
			logger.reportStart( LoggerAction.EXTRACT_BACKUP, __( 'Extracting backup files…' ) );
			break;
		case BackupExtractEvents.BACKUP_EXTRACT_PROGRESS: {
			const progressData = data as BackupExtractProgressEventData;
			if (
				progressData.processedFiles != null &&
				progressData.totalFiles != null &&
				progressData.totalFiles > 0
			) {
				logger.reportProgress(
					sprintf(
						_n(
							'Extracting backup file… (%1$d/%2$d)',
							'Extracting backup files… (%1$d/%2$d)',
							progressData.totalFiles
						),
						progressData.processedFiles,
						progressData.totalFiles
					)
				);
			}
			break;
		}
		case BackupExtractEvents.BACKUP_EXTRACT_COMPLETE:
			logger.reportSuccess( __( 'Backup extraction completed' ) );
			break;
		case BackupExtractEvents.BACKUP_EXTRACT_WARNING:
			logger.reportWarning(
				( data as string ) || __( 'A warning occurred while extracting backup' )
			);
			break;
		case BackupExtractEvents.BACKUP_EXTRACT_ERROR:
			throw new LoggerError(
				__( 'Failed to extract backup' ),
				data instanceof Error ? data : undefined
			);

		case ImporterEvents.IMPORT_START:
			logger.reportStart( LoggerAction.IMPORT_SITE, __( 'Importing backup…' ) );
			break;
		case ImporterEvents.IMPORT_DATABASE_START:
			logger.reportStart( LoggerAction.IMPORT_DATABASE, __( 'Importing database…' ) );
			break;
		case ImporterEvents.IMPORT_DATABASE_PROGRESS: {
			const progressData = data as ImportDatabaseProgressEventData;
			if (
				progressData.processedFiles != null &&
				progressData.totalFiles != null &&
				progressData.totalFiles > 0
			) {
				logger.reportProgress(
					sprintf(
						_n(
							'Importing database file… (%1$d/%2$d)',
							'Importing database files… (%1$d/%2$d)',
							progressData.totalFiles
						),
						progressData.processedFiles,
						progressData.totalFiles
					)
				);
			}
			break;
		}
		case ImporterEvents.IMPORT_DATABASE_COMPLETE:
			logger.reportSuccess( __( 'Database import completed' ) );
			break;

		case ImporterEvents.IMPORT_WP_CONTENT_START:
			logger.reportStart( LoggerAction.IMPORT_WP_CONTENT, __( 'Importing WordPress content…' ) );
			break;
		case ImporterEvents.IMPORT_WP_CONTENT_PROGRESS: {
			const progressData = data as ImportWpContentProgressEventData;
			if (
				progressData.processedItems != null &&
				progressData.totalItems != null &&
				progressData.totalItems > 0
			) {
				const baseMessage =
					WP_CONTENT_TYPE_LABELS[ progressData.type || 'other' ] ||
					__( 'Importing WordPress content…' );
				logger.reportProgress(
					sprintf(
						/* translators: %1$s is a content type label, %2$d is processed items, %3$d is total items */
						__( '%1$s (%2$d/%3$d)' ),
						baseMessage,
						progressData.processedItems,
						progressData.totalItems
					)
				);
			}
			break;
		}
		case ImporterEvents.IMPORT_WP_CONTENT_COMPLETE:
			logger.reportSuccess( __( 'WordPress content import completed' ) );
			break;

		case ImporterEvents.IMPORT_META_START:
			logger.reportStart( LoggerAction.IMPORT_META, __( 'Importing metadata…' ) );
			break;
		case ImporterEvents.IMPORT_META_COMPLETE:
			logger.reportSuccess( __( 'Metadata import completed' ) );
			break;
		case ImporterEvents.IMPORT_COMPLETE:
			logger.reportSuccess( __( 'Site imported successfully' ) );
			break;

		case ImporterEvents.IMPORT_ERROR:
			throw new LoggerError( __( 'Import failed' ), data instanceof Error ? data : undefined );
	}
}

export async function runCommand( siteFolder: string, importFile: string ): Promise< void > {
	let site: SiteData | undefined;
	let wasServerRunning = false;
	let importError: unknown;
	let restartError: unknown;

	try {
		logger.reportStart( LoggerAction.START_DAEMON, __( 'Starting process daemon…' ) );
		await connectToDaemon();
		logger.reportSuccess( __( 'Process daemon started' ) );

		logger.reportStart( LoggerAction.LOAD_SITES, __( 'Loading site…' ) );
		site = await getSiteByFolder( siteFolder );
		logger.reportSuccess( __( 'Site loaded' ) );

		wasServerRunning = !! ( await isServerRunning( site.id ) );

		if ( wasServerRunning ) {
			logger.reportStart( LoggerAction.STOP_SITE, __( 'Stopping WordPress server…' ) );
			await stopWordPressServer( site.id );
			await clearSiteLatestCliPid( site.id );
			logger.reportSuccess( __( 'WordPress server stopped' ) );
		}

		if ( ! fs.existsSync( importFile ) ) {
			throw new LoggerError( sprintf( __( 'Import file not found: %s' ), importFile ) );
		}

		if ( ! isWordPressDirectory( site.path ) ) {
			logger.reportStart( LoggerAction.SETUP_WORDPRESS, __( 'Copying bundled WordPress…' ) );
			await setupWordPressFilesOnly( site.path );
			logger.reportSuccess( __( 'WordPress files copied' ) );
		}

		logger.reportStart( LoggerAction.IMPORT_SITE, __( 'Starting import…' ) );

		await importBackup(
			{ path: importFile, type: getBackupFileType( importFile ) },
			site,
			importEventHandler,
			DEFAULT_IMPORTER_OPTIONS
		);

		// Something in Playground makes it so the front-end of the site sometimes returns an error page
		// on the first request. Send that first request from here to hide the error from the user.
		const siteUrl = getSiteUrl( site );
		await fetch( siteUrl ).catch( () => {} );
	} catch ( error ) {
		importError = error;
	} finally {
		try {
			if ( site && wasServerRunning ) {
				logger.reportStart(
					LoggerAction.INSTALL_SQLITE,
					__( 'Setting up SQLite integration, if needed…' )
				);
				await keepSqliteIntegrationUpdated( siteFolder );
				logger.reportSuccess( __( 'SQLite integration configured as needed' ) );

				logger.reportStart( LoggerAction.START_SITE, __( 'Starting WordPress server…' ) );
				await startWordPressServer( site, logger );
				logger.reportSuccess( __( 'WordPress server started' ) );
			}
		} catch ( error ) {
			restartError = error;
		} finally {
			await disconnectFromDaemon();
		}
	}

	if ( importError instanceof LoggerError && restartError instanceof Error ) {
		importError.previousError = restartError;
	}

	if ( importError instanceof Error ) {
		throw importError;
	}

	if ( restartError instanceof Error ) {
		throw importError;
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'import <import-file>',
		describe: __( 'Import a backup file to site' ),
		builder: ( yargs ) => {
			return yargs.positional( 'import-file', {
				type: 'string',
				normalize: true,
				demandOption: true,
				description: __( 'Path to the import file' ),
				coerce: ( value ) => {
					return path.resolve( untildify( value ) );
				},
			} );
		},
		handler: async ( argv ) => {
			try {
				await runCommand( argv.path, argv.importFile );
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					const loggerError = new LoggerError( __( 'Failed to import site' ), error );
					logger.reportError( loggerError );
				}
			}
		},
	} );
};
