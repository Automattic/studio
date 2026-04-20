import { shell, BrowserWindow, IpcMainInvokeEvent, Notification } from 'electron';
import fs from 'fs';
import { __ } from '@wordpress/i18n';
import { z } from 'zod';
import { showErrorMessageBox } from 'src/ipc-handlers';
import { bumpStat, getImporterMetric, StatsGroup, StatsMetric } from 'src/lib/bump-stats';
import { simplifyErrorForDisplay } from 'src/lib/error-formatting';
import { executeExportCliCommand } from 'src/modules/cli/lib/execute-export-command';
import { executeImportCliCommand } from 'src/modules/cli/lib/execute-import-command';
import { SiteServer } from 'src/site-server';

const errorSchema = z.object( { message: z.string() } );

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

	const errorToShow = simplifyErrorForDisplay( error );

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
				await fs.promises.unlink( importArchivePath );
			}

			resolve();
		} );

		eventEmitter.on( 'failed', async ( { error, displayError } ) => {
			bumpStat( StatsGroup.STUDIO_IMPORT, StatsMetric.FAILURE );

			if ( showErrorModal ) {
				await showImportErrorModal( event, displayError );
			}

			if ( removeBackupOnComplete ) {
				await fs.promises.unlink( importArchivePath );
			}

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

			if ( showErrorModal ) {
				await showExportErrorModal( event, displayError );
			}

			reject( error );
		} );
	} );
}
