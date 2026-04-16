import { shell, BrowserWindow, IpcMainInvokeEvent, Notification } from 'electron';
import { ExportEvents, ImporterEvents } from '@studio/common/lib/import-export-events';
import { __ } from '@wordpress/i18n';
import {
	executeExportCliCommand,
	exportEventSchema,
} from 'src/modules/cli/lib/execute-export-command';
import {
	executeImportCliCommand,
	importEventSchema,
} from 'src/modules/cli/lib/execute-import-command';

export async function importSite(
	event: IpcMainInvokeEvent,
	site: SiteDetails,
	importArchivePath: string
) {
	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	const eventEmitter = await executeImportCliCommand(
		site.id,
		[ 'import', '--path', site.path, importArchivePath ],
		parentWindow
	);

	eventEmitter.on( 'data', ( { data } ) => {
		const result = importEventSchema.safeParse( data );

		if ( result.success && result.data.event[ 0 ] === ImporterEvents.IMPORT_COMPLETE ) {
			const notif = new Notification( {
				title: site.name,
				body: __( 'Import completed' ),
			} );
			notif.show();
		}
	} );
}

export async function exportSite(
	event: IpcMainInvokeEvent,
	site: SiteDetails,
	destinationPath: string
) {
	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	const eventEmitter = await executeExportCliCommand(
		site.id,
		[ 'export', '--path', site.path, destinationPath ],
		parentWindow
	);

	eventEmitter.on( 'data', ( { data } ) => {
		const result = exportEventSchema.safeParse( data );

		if ( result.success && result.data.event[ 0 ] === ExportEvents.EXPORT_COMPLETE ) {
			shell.showItemInFolder( destinationPath );
		}
	} );

	return eventEmitter;
}
