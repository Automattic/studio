import { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { executePreviewCliCommand } from 'src/modules/cli/lib/execute-preview-command';

export async function createSnapshot( event: IpcMainInvokeEvent, siteFolder: string ) {
	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	return executePreviewCliCommand( [ 'preview', 'create', '--path', siteFolder ], parentWindow );
}

export async function updateSnapshot(
	event: IpcMainInvokeEvent,
	siteFolder: string,
	hostname: string
) {
	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	return executePreviewCliCommand(
		[ 'preview', 'update', '--path', siteFolder, hostname ],
		parentWindow
	);
}

export async function deleteSnapshot( event: IpcMainInvokeEvent, hostname: string ) {
	const parentWindow = BrowserWindow.fromWebContents( event.sender );
	return executePreviewCliCommand( [ 'preview', 'delete', hostname ], parentWindow );
}
