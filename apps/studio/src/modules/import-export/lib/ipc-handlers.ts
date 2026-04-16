import { shell, BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { ExportEvents } from '@studio/common/lib/import-export-events';
import {
	executeExportCliCommand,
	exportEventSchema,
} from 'src/modules/cli/lib/execute-export-command';
import { executeImportCliCommand } from 'src/modules/cli/lib/execute-import-command';

export async function importSite(
	event: IpcMainInvokeEvent,
	site: SiteDetails,
	importArchivePath: string
) {
	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	return executeImportCliCommand(
		site.id,
		[ 'import', '--path', site.path, importArchivePath ],
		parentWindow
	);
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
