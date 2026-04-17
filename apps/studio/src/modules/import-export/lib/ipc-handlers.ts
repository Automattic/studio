import { shell, BrowserWindow, IpcMainInvokeEvent, Notification } from 'electron';
import fs from 'fs';
import { ExportEvents, ImporterEvents } from '@studio/common/lib/import-export-events';
import { __, sprintf } from '@wordpress/i18n';
import { z } from 'zod';
import { WP_CLI_IMPORT_EXPORT_RESPONSE_TIMEOUT_IN_HRS } from 'src/constants';
import { showErrorMessageBox } from 'src/ipc-handlers';
import { bumpStat, getImporterMetric, StatsGroup, StatsMetric } from 'src/lib/bump-stats';
import { simplifyErrorForDisplay } from 'src/lib/error-formatting';
import {
	executeExportCliCommand,
	exportEventSchema,
} from 'src/modules/cli/lib/execute-export-command';
import { executeImportCliCommand, messageSchema } from 'src/modules/cli/lib/execute-import-command';
import { SiteServer } from 'src/site-server';

const errorSchema = z.object( { message: z.string() } );

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

	const eventEmitter = await executeImportCliCommand( site.details.id, args, parentWindow );

	return new Promise< void >( ( resolve, reject ) => {
		eventEmitter.on( 'data', async ( { data } ) => {
			const result = messageSchema.safeParse( data );

			if ( ! result.success ) {
				return;
			}

			const parsed = result.data;

			if ( parsed.event[ 0 ] === ImporterEvents.IMPORT_START ) {
				bumpStat( StatsGroup.STUDIO_IMPORT, getImporterMetric( parsed.event[ 1 ] ) );
			}

			if ( parsed.event[ 0 ] === ImporterEvents.IMPORT_COMPLETE && showNotification ) {
				const notification = new Notification( {
					title: site.details.name,
					body: __( 'Import completed' ),
				} );
				notification.show();
			}

			if ( parsed.event[ 0 ] === ImporterEvents.IMPORT_ERROR && showErrorModal ) {
				const error = parsed.event[ 1 ];
				const parsedError = errorSchema.safeParse( error );

				if (
					parsedError.success &&
					parsedError.data.message.includes( 'Error: absolute path: /' )
				) {
					await showErrorMessageBox( event, {
						title: __( 'Failed importing site' ),
						message: __(
							'The ZIP archive is invalid. Try to unpack and pack it again. If this problem persists, please contact support.'
						),
					} );
				} else if (
					parsedError.success &&
					parsedError.data.message.includes( 'WP-CLI command was canceled (timed out)' )
				) {
					await showErrorMessageBox( event, {
						title: __( 'Failed importing site' ),
						message: sprintf(
							__(
								'The import process timed out after %d hours, which can occur when processing very large imports. If the issue persists, please contact support.'
							),
							WP_CLI_IMPORT_EXPORT_RESPONSE_TIMEOUT_IN_HRS
						),
					} );
				} else {
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
			}
		} );

		eventEmitter.on( 'success', async () => {
			resolve();

			if ( removeBackupOnComplete ) {
				await fs.promises.unlink( importArchivePath );
			}
		} );

		eventEmitter.on( 'error', ( { error } ) => {
			reject( error );
			bumpStat( StatsGroup.STUDIO_IMPORT, StatsMetric.FAILURE );
		} );

		eventEmitter.on( 'failure', async ( { error } ) => {
			reject( error );
			bumpStat( StatsGroup.STUDIO_IMPORT, StatsMetric.FAILURE );

			if ( removeBackupOnComplete ) {
				await fs.promises.unlink( importArchivePath );
			}
		} );
	} );
}

type ExportOptions = {
	mode: 'full' | 'content' | 'db';
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

	const eventEmitter = await executeExportCliCommand( site.details.id, args, parentWindow );

	return new Promise< void >( ( resolve, reject ) => {
		eventEmitter.on( 'started', () => {
			bumpStat(
				StatsGroup.STUDIO_EXPORT,
				mode === 'db' ? StatsMetric.DATABASE_ONLY : StatsMetric.FULL_SITE
			);
		} );

		eventEmitter.on( 'data', ( { data } ) => {
			const result = exportEventSchema.safeParse( data );

			if ( result.success && result.data.event[ 0 ] === ExportEvents.EXPORT_COMPLETE ) {
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
			}
		} );

		eventEmitter.on( 'error', ( { error } ) => {
			reject( error );
			bumpStat( StatsGroup.STUDIO_EXPORT, StatsMetric.FAILURE );
		} );

		eventEmitter.on( 'failure', ( { error } ) => {
			reject( error );
			bumpStat( StatsGroup.STUDIO_EXPORT, StatsMetric.FAILURE );
		} );

		eventEmitter.on( 'success', () => {
			resolve();
		} );
	} );
}
