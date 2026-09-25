import { shell, BrowserWindow, IpcMainInvokeEvent, Notification } from 'electron';
import fs from 'fs';
import * as Sentry from '@sentry/electron/main';
import { getErrorMessage } from '@studio/common/lib/error-formatting';
import { exportErrorPayloadSchema } from '@studio/common/lib/import-export-events';
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
	return value.replace( /^Failed to import site:\s*/i, '' ).trim();
}

function getBestEffortImportError( error: unknown ): Error {
	const fallbackMessage = __( 'Check Studio Logs for more details.' );

	if ( error instanceof CliCommandError ) {
		const sanitizedLastErrorMessage = sanitizeImportErrorText( error.lastErrorMessage ?? '' );
		if ( sanitizedLastErrorMessage ) {
			return new Error( sanitizedLastErrorMessage );
		}
	}

	const sanitizedMessage = sanitizeImportErrorText( getErrorMessage( error ) ?? '' );
	return new Error( sanitizedMessage || fallbackMessage );
}

function getBestEffortExportError( error: unknown ): Error {
	const fallbackMessage = __( 'Check Studio Logs for more details.' );
	const parsedExportError = exportErrorPayloadSchema.safeParse( error );

	if ( parsedExportError.success ) {
		const message = getErrorMessage( parsedExportError.data.message );
		return new Error( message ?? fallbackMessage );
	}

	if ( error instanceof CliCommandError ) {
		const lastErrorMessage = getErrorMessage( error.lastErrorMessage );
		if ( lastErrorMessage ) {
			return new Error( lastErrorMessage );
		}
	}

	return new Error( getErrorMessage( error ) ?? fallbackMessage );
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
	const parsedError = errorSchema.safeParse( error );

	if ( parsedError.success && parsedError.data.message.includes( 'Error: absolute path: /' ) ) {
		await showErrorMessageBox( event, {
			title: __( 'Failed importing site' ),
			message: __(
				'The ZIP archive is invalid. Try to unpack and pack it again. If this problem persists, please contact support.'
			),
		} );
		return;
	}

	const errorToShow = simplifyErrorForDisplay( getBestEffortImportError( error ) );

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
	suppressTracksEvent?: boolean;
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
		suppressTracksEvent = false,
	} = options;

	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	const args = [ 'import', '--path', site.details.path, importArchivePath ];

	if ( alwaysStartServer ) {
		args.push( '--start-server' );
	}

	if ( suppressTracksEvent ) {
		args.push( '--suppress-tracks-event' );
	}

	const eventEmitter = executeImportCliCommand( site.details.id, args, parentWindow );

	return new Promise< void >( ( resolve, reject ) => {
		eventEmitter.on( 'completed', async ( { importerType } ) => {
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

			resolve();
		} );

		eventEmitter.on( 'failed', async ( { error, displayError } ) => {
			bumpStat( StatsGroup.STUDIO_IMPORT, StatsMetric.FAILURE );

			if ( ! isExpectedImportError( displayError ) ) {
				Sentry.captureException( displayError );
			}

			if ( showErrorModal ) {
				await showImportErrorModal( event, displayError );
			}

			if ( removeBackupOnComplete ) {
				await removeFileIfExists( importArchivePath );
			}

			reject( error );
		} );
	} );
}

async function showExportErrorModal( event: IpcMainInvokeEvent, error: unknown ) {
	const errorToShow = simplifyErrorForDisplay(
		getBestEffortExportError( error ),
		__( 'Check Studio Logs for more details.' )
	);

	await showErrorMessageBox( event, {
		title: __( 'Failed exporting site' ),
		message: __(
			'An error occurred while exporting the site. If this problem persists, please contact support.'
		),
		error: errorToShow,
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
	applyDeployIgnore?: boolean;
	abortSignal?: AbortSignal;
	suppressTracksEvent?: boolean;
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
		applyDeployIgnore = false,
		abortSignal,
		suppressTracksEvent = false,
	} = options;

	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	const args = [ 'export', '--path', site.details.path, destinationPath, '--mode', mode ];

	if ( splitDatabaseDumpByTable ) {
		args.push( '--split-db-dump-by-table' );
	}

	if ( suppressTracksEvent ) {
		args.push( '--suppress-tracks-event' );
	}

	if ( applyDeployIgnore ) {
		args.push( '--apply-deploy-ignore' );
	}

	if ( specificSelectionPaths.length > 0 ) {
		args.push( '--include-only', ...specificSelectionPaths );
	}

	const eventEmitter = executeExportCliCommand( site.details.id, args, parentWindow, {
		abortSignal,
	} );

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
			if ( abortSignal?.aborted ) {
				reject( error );
				return;
			}

			bumpStat( StatsGroup.STUDIO_EXPORT, StatsMetric.FAILURE );

			Sentry.captureException( displayError );

			if ( showErrorModal ) {
				await showExportErrorModal( event, displayError );
			}

			reject( error );
		} );
	} );
}
