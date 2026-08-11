import fs from 'fs';
import path from 'path';
import { SITE_EVENTS } from '@studio/common/lib/cli-events';
import { isWordPressDirectory, recursiveCopyDirectory } from '@studio/common/lib/fs-utils';
import {
	BackupExtractEvents,
	ImporterEvents,
	ImporterType,
	ImportEventTuple,
	ImportIpcEvent,
	ValidatorEvents,
} from '@studio/common/lib/import-export-events';
import { getServerFilesPath } from '@studio/common/lib/well-known-paths';
import { SiteCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __, _n, sprintf } from '@wordpress/i18n';
import { SiteData } from 'cli/lib/cli-config/core';
import {
	clearSiteLatestCliPid,
	getSiteByFolder,
	getSiteUrl,
	updateSitePhpVersion,
} from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon, emitCliEvent } from 'cli/lib/daemon-client';
import { ImportExportEventEmitter } from 'cli/lib/import-export/events';
import { DEFAULT_IMPORTER_OPTIONS, getImporter } from 'cli/lib/import-export/import/import-manager';
import { getBackupFileType } from 'cli/lib/import-export/utils';
import { keepSqliteIntegrationUpdated } from 'cli/lib/sqlite-integration';
import { getTracksOrigin, recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';
import { classifyImportFailure, untildify } from 'cli/lib/utils';
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
			),
			undefined,
			'bundled_wp_missing'
		);
	}

	await recursiveCopyDirectory( bundledWpPath, sitePath );
}

function sendIpcEvent( eventTuple: ImportEventTuple ) {
	const ipcEvent: ImportIpcEvent = { event: eventTuple };
	process.send!( ipcEvent );
}

function handleImportIpc( emitter: ImportExportEventEmitter ) {
	emitter.on( ValidatorEvents.IMPORT_VALIDATION_START, () => {
		sendIpcEvent( [ ValidatorEvents.IMPORT_VALIDATION_START, undefined ] );
	} );
	emitter.on( ValidatorEvents.IMPORT_VALIDATION_COMPLETE, () => {
		sendIpcEvent( [ ValidatorEvents.IMPORT_VALIDATION_COMPLETE, undefined ] );
	} );
	emitter.on( ValidatorEvents.IMPORT_VALIDATION_ERROR, ( error ) => {
		sendIpcEvent( [ ValidatorEvents.IMPORT_VALIDATION_ERROR, error ] );
	} );
	emitter.on( BackupExtractEvents.BACKUP_EXTRACT_START, () => {
		sendIpcEvent( [ BackupExtractEvents.BACKUP_EXTRACT_START, undefined ] );
	} );
	emitter.on( BackupExtractEvents.BACKUP_EXTRACT_PROGRESS, ( progressData ) => {
		sendIpcEvent( [ BackupExtractEvents.BACKUP_EXTRACT_PROGRESS, progressData ] );
	} );
	emitter.on( BackupExtractEvents.BACKUP_EXTRACT_COMPLETE, () => {
		sendIpcEvent( [ BackupExtractEvents.BACKUP_EXTRACT_COMPLETE, undefined ] );
	} );
	emitter.on( BackupExtractEvents.BACKUP_EXTRACT_WARNING, ( warningMessage ) => {
		sendIpcEvent( [ BackupExtractEvents.BACKUP_EXTRACT_WARNING, warningMessage ] );
	} );
	emitter.on( BackupExtractEvents.BACKUP_EXTRACT_ERROR, ( error ) => {
		sendIpcEvent( [ BackupExtractEvents.BACKUP_EXTRACT_ERROR, error ] );
	} );
	emitter.on( ImporterEvents.IMPORT_START, ( importerType ) => {
		sendIpcEvent( [ ImporterEvents.IMPORT_START, importerType ] );
	} );
	emitter.on( ImporterEvents.IMPORT_DATABASE_START, () => {
		sendIpcEvent( [ ImporterEvents.IMPORT_DATABASE_START, undefined ] );
	} );
	emitter.on( ImporterEvents.IMPORT_DATABASE_PROGRESS, ( progressData ) => {
		sendIpcEvent( [ ImporterEvents.IMPORT_DATABASE_PROGRESS, progressData ] );
	} );
	emitter.on( ImporterEvents.IMPORT_DATABASE_COMPLETE, () => {
		sendIpcEvent( [ ImporterEvents.IMPORT_DATABASE_COMPLETE, undefined ] );
	} );
	emitter.on( ImporterEvents.IMPORT_WP_CONTENT_START, () => {
		sendIpcEvent( [ ImporterEvents.IMPORT_WP_CONTENT_START, undefined ] );
	} );
	emitter.on( ImporterEvents.IMPORT_WP_CONTENT_PROGRESS, ( progressData ) => {
		sendIpcEvent( [ ImporterEvents.IMPORT_WP_CONTENT_PROGRESS, progressData ] );
	} );
	emitter.on( ImporterEvents.IMPORT_WP_CONTENT_COMPLETE, () => {
		sendIpcEvent( [ ImporterEvents.IMPORT_WP_CONTENT_COMPLETE, undefined ] );
	} );
	emitter.on( ImporterEvents.IMPORT_META_START, () => {
		sendIpcEvent( [ ImporterEvents.IMPORT_META_START, undefined ] );
	} );
	emitter.on( ImporterEvents.IMPORT_META_COMPLETE, () => {
		sendIpcEvent( [ ImporterEvents.IMPORT_META_COMPLETE, undefined ] );
	} );
	emitter.on( ImporterEvents.IMPORT_COMPLETE, ( importerType ) => {
		sendIpcEvent( [ ImporterEvents.IMPORT_COMPLETE, importerType ] );
	} );
	emitter.on( ImporterEvents.IMPORT_ERROR, ( error ) => {
		sendIpcEvent( [ ImporterEvents.IMPORT_ERROR, error ] );
	} );
}

export function handleImportEvents( emitter: ImportExportEventEmitter ): void {
	emitter.on( ValidatorEvents.IMPORT_VALIDATION_START, () => {
		logger.reportSuccess( sprintf( __( 'Started import…' ) ) );
		logger.reportStart( LoggerAction.VALIDATE, __( 'Validating backup…' ) );
	} );

	emitter.on( ValidatorEvents.IMPORT_VALIDATION_COMPLETE, () => {
		logger.reportSuccess( __( 'Backup validated' ) );
	} );

	emitter.on( ValidatorEvents.IMPORT_VALIDATION_ERROR, ( error ) => {
		throw new LoggerError(
			__( 'Backup validation failed' ),
			error instanceof Error ? error : undefined
		);
	} );

	emitter.on( BackupExtractEvents.BACKUP_EXTRACT_START, () => {
		logger.reportStart( LoggerAction.EXTRACT_BACKUP, __( 'Extracting backup files…' ) );
	} );

	emitter.on( BackupExtractEvents.BACKUP_EXTRACT_PROGRESS, ( progressData ) => {
		if (
			progressData.processedFiles !== undefined &&
			progressData.totalFiles !== undefined &&
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
	} );

	emitter.on( BackupExtractEvents.BACKUP_EXTRACT_COMPLETE, () => {
		logger.reportSuccess( __( 'Backup extraction completed' ) );
	} );

	emitter.on( BackupExtractEvents.BACKUP_EXTRACT_WARNING, ( warningMessage ) => {
		logger.reportWarning( warningMessage || __( 'A warning occurred while extracting backup' ) );
	} );

	emitter.on( BackupExtractEvents.BACKUP_EXTRACT_ERROR, ( error ) => {
		throw new LoggerError(
			__( 'Failed to extract backup' ),
			error instanceof Error ? error : undefined,
			'extract'
		);
	} );

	emitter.on( ImporterEvents.IMPORT_START, () => {
		logger.reportStart( LoggerAction.IMPORT_SITE, __( 'Importing backup…' ) );
	} );

	emitter.on( ImporterEvents.IMPORT_DATABASE_START, () => {
		logger.reportStart( LoggerAction.IMPORT_DATABASE, __( 'Importing database…' ) );
	} );

	emitter.on( ImporterEvents.IMPORT_DATABASE_PROGRESS, ( progressData ) => {
		if (
			progressData.processedFiles !== undefined &&
			progressData.totalFiles !== undefined &&
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
	} );

	emitter.on( ImporterEvents.IMPORT_DATABASE_COMPLETE, () => {
		logger.reportSuccess( __( 'Database import completed' ) );
	} );

	emitter.on( ImporterEvents.IMPORT_WP_CONTENT_START, () => {
		logger.reportStart( LoggerAction.IMPORT_WP_CONTENT, __( 'Importing WordPress content…' ) );
	} );

	emitter.on( ImporterEvents.IMPORT_WP_CONTENT_PROGRESS, ( progressData ) => {
		if (
			progressData.processedItems !== undefined &&
			progressData.totalItems !== undefined &&
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
	} );

	emitter.on( ImporterEvents.IMPORT_WP_CONTENT_COMPLETE, () => {
		logger.reportSuccess( __( 'WordPress content import completed' ) );
	} );

	emitter.on( ImporterEvents.IMPORT_META_START, () => {
		logger.reportStart( LoggerAction.IMPORT_META, __( 'Importing metadata…' ) );
	} );

	emitter.on( ImporterEvents.IMPORT_META_COMPLETE, () => {
		logger.reportSuccess( __( 'Metadata import completed' ) );
	} );

	emitter.on( ImporterEvents.IMPORT_COMPLETE, () => {
		logger.reportSuccess( __( 'Site imported successfully' ) );
	} );

	// No IMPORT_ERROR handler: every emitter rethrows the original error right after emitting, and
	// that error carries the failure `code` for analytics — a wrap here would discard it.
}

export async function runCommand(
	siteFolder: string,
	importFile: string,
	alwaysStartServer = false,
	suppressTracksEvent = false
): Promise< void > {
	const startedAt = Date.now();
	let site: SiteData | undefined;
	let wasServerRunning = false;
	let importError: unknown;
	let restartSiteError: unknown;
	let importerType: ImporterType | undefined;

	try {
		logger.reportStart( LoggerAction.START_DAEMON, __( 'Starting process daemon…' ) );
		await connectToDaemon();
		logger.reportSuccess( __( 'Process daemon started' ) );

		logger.reportStart( LoggerAction.LOAD_SITES, __( 'Loading site…' ) );
		site = await getSiteByFolder( siteFolder );
		logger.reportSuccess( __( 'Site loaded' ) );

		if ( ! fs.existsSync( importFile ) ) {
			throw new LoggerError(
				sprintf( __( 'Import file not found: %s' ), importFile ),
				undefined,
				'file_not_found'
			);
		}

		wasServerRunning = !! ( await isServerRunning( site.id ) );

		if ( wasServerRunning ) {
			logger.reportStart( LoggerAction.STOP_SITE, __( 'Stopping WordPress server…' ) );
			await stopWordPressServer( site.id );
			await clearSiteLatestCliPid( site.id );
			logger.reportSuccess( __( 'WordPress server stopped' ) );
		}

		if ( ! isWordPressDirectory( site.path ) ) {
			logger.reportStart( LoggerAction.SETUP_WORDPRESS, __( 'Copying bundled WordPress…' ) );
			await setupWordPressFilesOnly( site.path );
			logger.reportSuccess( __( 'WordPress files copied' ) );
		}

		logger.reportStart( LoggerAction.IMPORT_SITE, __( 'Starting import…' ) );

		const importer = getImporter(
			{ path: importFile, type: getBackupFileType( importFile ) },
			DEFAULT_IMPORTER_OPTIONS
		);
		importer.on( ImporterEvents.IMPORT_START, ( type ) => {
			importerType = type;
		} );
		if ( process.send ) {
			handleImportIpc( importer );
		} else {
			handleImportEvents( importer );
		}
		const importResult = await importer.import( site );
		const importedPhpVersion = importResult.meta?.phpVersion;
		if ( importedPhpVersion && importedPhpVersion !== site.phpVersion ) {
			await updateSitePhpVersion( site.id, importedPhpVersion );
			site.phpVersion = importedPhpVersion;
		}

		// Something in Playground makes it so the front-end of the site sometimes returns an error page
		// on the first request. Send that first request from here to hide the error from the user.
		const siteUrl = getSiteUrl( site );
		await fetch( siteUrl ).catch( () => {} );

		await emitCliEvent( { event: SITE_EVENTS.UPDATED, data: { siteId: site.id } } );
	} catch ( error ) {
		importError = error;
	} finally {
		try {
			if ( site && ( wasServerRunning || alwaysStartServer ) ) {
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
			restartSiteError = error;
		} finally {
			await disconnectFromDaemon();
		}
	}

	// Record before the LoggerError merge below — merging the restart error into `previousError`
	// would corrupt the failure classification, which walks the import error's chain.
	if ( ! suppressTracksEvent ) {
		await recordSiteImportEvent(
			importError === undefined
				? {
						success: true,
						importer_type: importerType ?? 'unknown',
						time_ms: Date.now() - startedAt,
				  }
				: {
						success: false,
						importer_type: importerType ?? 'unknown',
						failure_reason: classifyImportFailure( importError ),
						time_ms: Date.now() - startedAt,
				  }
		);
	}

	if ( importError instanceof LoggerError && restartSiteError instanceof Error ) {
		importError.previousError = restartSiteError;
	}

	if ( importError instanceof Error ) {
		throw importError;
	}

	if ( restartSiteError instanceof Error ) {
		throw restartSiteError;
	}
}

async function recordSiteImportEvent( props: {
	success: boolean;
	importer_type: ImporterType | 'unknown';
	failure_reason?: string;
	time_ms: number;
} ): Promise< void > {
	try {
		await recordTracksEvent( TRACKS_EVENTS.SITE_IMPORT, {
			...props,
			...getTracksOrigin(),
		} );
	} catch {
		// Best-effort telemetry — never block or fail the import.
	}
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'import <import-file>',
		describe: __( 'Import a backup file to site' ),
		builder: ( yargs ) => {
			return yargs
				.positional( 'import-file', {
					type: 'string',
					normalize: true,
					demandOption: true,
					description: __( 'Path to the import file' ),
					coerce: ( value ) => {
						return path.resolve( untildify( value ) );
					},
				} )
				.option( 'start-server', {
					type: 'boolean',
					default: false,
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
				await runCommand( argv.path, argv.importFile, argv.startServer, argv.suppressTracksEvent );
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
