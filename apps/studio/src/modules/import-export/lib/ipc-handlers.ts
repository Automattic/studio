import { shell, BrowserWindow, IpcMainInvokeEvent, Notification } from 'electron';
import fs from 'fs';
import { stripVTControlCharacters } from 'util';
import * as Sentry from '@sentry/electron/main';
import { isErrnoException } from '@studio/common/lib/is-errno-exception';
import { __ } from '@wordpress/i18n';
import { z } from 'zod';
import { showErrorMessageBox } from 'src/ipc-handlers';
import { bumpStat, getImporterMetric, StatsGroup, StatsMetric } from 'src/lib/bump-stats';
import { simplifyErrorForDisplay } from 'src/lib/error-formatting';
import { CliCommandError } from 'src/modules/cli/lib/execute-command';
import { executeExportCliCommand } from 'src/modules/cli/lib/execute-export-command';
import { executeImportCliCommand } from 'src/modules/cli/lib/execute-import-command';
import { SiteServer } from 'src/site-server';

const errorSchema = z.object( { message: z.string() } );

const EXPECTED_IMPORT_ERROR_SUBSTRINGS = [
	'No suitable importer found for the provided backup contents',
	'No suitable backup handler found for the provided backup file',
];

function isExpectedImportError( error: unknown ): boolean {
	const parsed = errorSchema.safeParse( error );
	if ( ! parsed.success ) {
		return false;
	}
	return EXPECTED_IMPORT_ERROR_SUBSTRINGS.some( ( substring ) =>
		parsed.data.message.includes( substring )
	);
}

function sanitizeImportErrorText( value: string ): string {
	return stripVTControlCharacters( value )
		.replace( /^Failed to import site:\s*/i, '' )
		.trim()
		.split( '\n' )[ 0 ]
		.trim();
}

function getBestEffortImportError( error: unknown ): unknown {
	if ( error instanceof CliCommandError ) {
		const sanitizedLastErrorMessage = sanitizeImportErrorText( error.lastErrorMessage ?? '' );
		if ( sanitizedLastErrorMessage ) {
			return new Error( sanitizedLastErrorMessage );
		}
	}

	if ( error instanceof Error ) {
		const sanitizedMessage = sanitizeImportErrorText( error.message );
		return new Error( sanitizedMessage );
	}

	return error;
}

async function removeFileIfExists( filePath: string ) {
	try {
		await fs.promises.unlink( filePath );
	} catch ( error ) {
		if ( isErrnoException( error ) && error.code !== 'ENOENT' ) {
			console.warn( `Failed to remove file: ${ filePath }`, error );
		}
	}
}

async function showImportErrorModal( event: IpcMainInvokeEvent, error: unknown ) {
	console.log( '[IMPORT DEBUG][importSite IPC] showImportErrorModal called', {
		errorType: typeof error,
	} );
	const parsedError = errorSchema.safeParse( error );

	if ( parsedError.success && parsedError.data.message.includes( 'Error: absolute path: /' ) ) {
		console.log(
			'[IMPORT DEBUG][importSite IPC] showing ZIP absolute-path validation modal',
			parsedError.data.message
		);
		await showErrorMessageBox( event, {
			title: __( 'Failed importing site' ),
			message: __(
				'The ZIP archive is invalid. Try to unpack and pack it again. If this problem persists, please contact support.'
			),
		} );
		return;
	}

	const errorToShow = simplifyErrorForDisplay( getBestEffortImportError( error ) );
	console.log( '[IMPORT DEBUG][importSite IPC] showing generic import error modal', {
		errorMessage: errorToShow instanceof Error ? errorToShow.message : String( errorToShow ),
	} );

	await showErrorMessageBox( event, {
		title: __( 'Failed importing site' ),
		message: __(
			'An error occurred while importing the site. Verify the file is a valid Jetpack backup, Local, Playground, .wpress or .sql database file and try again. If this problem persists, please contact support.'
		),
		error: errorToShow,
		showOpenLogs: true,
	} );
}

type ImportOptions = {
	alwaysStartServer?: boolean;
	removeBackupOnComplete?: boolean;
	showErrorModal?: boolean;
	showNotification?: boolean;
};

export async function importSite(
	event: IpcMainInvokeEvent,
	siteId: string,
	importArchivePath: string,
	options: ImportOptions = {}
): Promise< void > {
	const site = SiteServer.get( siteId );
	if ( ! site ) {
		throw new Error( 'Site not found.' );
	}

	const {
		alwaysStartServer = false,
		removeBackupOnComplete = false,
		showErrorModal = true,
		showNotification = true,
	} = options;

	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	const args = [ 'import', '--path', site.details.path, importArchivePath ];

	if ( alwaysStartServer ) {
		args.push( '--start-server' );
	}

	console.log( '[IMPORT DEBUG][importSite IPC] invoking CLI import', {
		siteId,
		importArchivePath,
		args,
		alwaysStartServer,
		removeBackupOnComplete,
		showErrorModal,
		showNotification,
		parentWindowAvailable: !! parentWindow && ! parentWindow.isDestroyed(),
	} );

	const eventEmitter = executeImportCliCommand( site.details.id, args, parentWindow );
	console.log( '[IMPORT DEBUG][importSite IPC] lifecycle listeners attached', {
		siteId: site.details.id,
	} );

	return new Promise< void >( ( resolve, reject ) => {
		let didSettle = false;
		const watchdog = setTimeout( () => {
			if ( ! didSettle ) {
				console.error(
					'[IMPORT DEBUG][importSite IPC] watchdog: no completed/failed event after 15s',
					{ siteId: site.details.id, importArchivePath }
				);
			}
		}, 15_000 );

		eventEmitter.on( 'completed', async ( { importerType } ) => {
			didSettle = true;
			clearTimeout( watchdog );
			console.log( '[IMPORT DEBUG][importSite IPC] received "completed" event', {
				importerType,
			} );
			bumpStat( StatsGroup.STUDIO_IMPORT, getImporterMetric( importerType ) );

			if ( showNotification ) {
				const notification = new Notification( {
					title: site.details.name,
					body: __( 'Import completed' ),
				} );
				notification.show();
			}

			if ( removeBackupOnComplete ) {
				await removeFileIfExists( importArchivePath );
			}

			console.log( '[IMPORT DEBUG][importSite IPC] resolving importSite promise' );
			resolve();
		} );

		eventEmitter.on( 'failed', async ( { error, displayError } ) => {
			didSettle = true;
			clearTimeout( watchdog );
			console.error( '[IMPORT DEBUG][importSite IPC] received "failed" event', {
				errorName: error.name,
				errorMessage: error.message,
				displayErrorType: typeof displayError,
			} );
			bumpStat( StatsGroup.STUDIO_IMPORT, StatsMetric.FAILURE );

			if ( ! isExpectedImportError( displayError ) ) {
				Sentry.captureException( displayError );
			}

			if ( showErrorModal ) {
				try {
					await showImportErrorModal( event, displayError );
				} catch ( e ) {
					console.error( '[IMPORT DEBUG][importSite IPC] failed to show import error modal', e );
				}
			}

			if ( removeBackupOnComplete ) {
				await removeFileIfExists( importArchivePath );
			}

			console.error( '[IMPORT DEBUG][importSite IPC] rejecting importSite promise', {
				errorName: error.name,
			} );
			reject( error );
		} );
	} );
}

async function showExportErrorModal( event: IpcMainInvokeEvent, error: unknown ) {
	await showErrorMessageBox( event, {
		title: __( 'Failed exporting site' ),
		message: __(
			'An error occurred while exporting the site. If this problem persists, please contact support.'
		),
		error,
		showOpenLogs: true,
	} );
}

type ExportOptions = {
	mode: 'full' | 'content' | 'db';
	showErrorModal?: boolean;
	showItemInFolder?: boolean;
	showNotification?: boolean;
	splitDatabaseDumpByTable?: boolean;
	specificSelectionPaths?: string[];
};

export async function exportSite(
	event: IpcMainInvokeEvent,
	siteId: string,
	destinationPath: string,
	options: ExportOptions
): Promise< void > {
	const site = SiteServer.get( siteId );
	if ( ! site ) {
		throw new Error( 'Site not found.' );
	}

	const {
		mode,
		showErrorModal = true,
		showItemInFolder = false,
		showNotification = false,
		splitDatabaseDumpByTable = false,
		specificSelectionPaths = [],
	} = options;

	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	const args = [ 'export', '--path', site.details.path, destinationPath, '--mode', mode ];

	if ( splitDatabaseDumpByTable ) {
		args.push( '--split-db-dump-by-table' );
	}

	if ( specificSelectionPaths.length > 0 ) {
		args.push( '--include-only', ...specificSelectionPaths );
	}

	const eventEmitter = executeExportCliCommand( site.details.id, args, parentWindow );

	return new Promise< void >( ( resolve, reject ) => {
		eventEmitter.on( 'completed', () => {
			bumpStat(
				StatsGroup.STUDIO_EXPORT,
				mode === 'db' ? StatsMetric.DATABASE_ONLY : StatsMetric.FULL_SITE
			);

			if ( showNotification ) {
				const notification = new Notification( {
					title: site.details.name,
					body: __( 'Export completed' ),
				} );
				notification.show();
			}

			if ( showItemInFolder ) {
				shell.showItemInFolder( destinationPath );
			}

			resolve();
		} );

		eventEmitter.on( 'failed', async ( { error, displayError } ) => {
			bumpStat( StatsGroup.STUDIO_EXPORT, StatsMetric.FAILURE );

			Sentry.captureException( displayError );

			if ( showErrorModal ) {
				await showExportErrorModal( event, displayError );
			}

			reject( error );
		} );
	} );
}
