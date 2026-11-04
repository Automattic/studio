import { webContents, type IpcMainInvokeEvent, type WebContents } from 'electron';

export function getOwnedWebviewContents(
	event: IpcMainInvokeEvent,
	webContentsId: number
): WebContents {
	if ( ! Number.isInteger( webContentsId ) || webContentsId <= 0 ) {
		throw new Error( 'Invalid webview identifier.' );
	}
	const target = webContents.fromId( webContentsId );
	if ( ! target || target.isDestroyed() ) {
		throw new Error( 'Webview is no longer available.' );
	}
	if ( target.getType() !== 'webview' || target.hostWebContents?.id !== event.sender.id ) {
		throw new Error( 'Webview does not belong to the current window.' );
	}
	return target;
}

export function openWebviewDevTools( event: IpcMainInvokeEvent, webContentsId: number ): void {
	getOwnedWebviewContents( event, webContentsId ).openDevTools( { mode: 'detach' } );
}

export async function setWebviewColorScheme(
	event: IpcMainInvokeEvent,
	webContentsId: number,
	colorScheme: 'system' | 'light' | 'dark'
): Promise< void > {
	if ( ! [ 'system', 'light', 'dark' ].includes( colorScheme ) ) {
		throw new Error( 'Invalid preview color scheme.' );
	}
	const target = getOwnedWebviewContents( event, webContentsId );
	if ( colorScheme === 'system' && ! target.debugger.isAttached() ) return;
	if ( ! target.debugger.isAttached() ) {
		target.debugger.attach( '1.3' );
	}
	await target.debugger.sendCommand( 'Emulation.setEmulatedMedia', {
		features:
			colorScheme === 'system' ? [] : [ { name: 'prefers-color-scheme', value: colorScheme } ],
	} );
}

export async function clearWebviewBrowsingData(
	event: IpcMainInvokeEvent,
	webContentsId: number
): Promise< void > {
	const target = getOwnedWebviewContents( event, webContentsId );
	const previews = webContents
		.getAllWebContents()
		.filter(
			( contents ) => contents.getType() === 'webview' && contents.session === target.session
		);
	for ( const preview of previews ) {
		preview.stop();
	}
	await target.session.clearData();
	for ( const preview of previews ) {
		if ( preview.isDestroyed() ) continue;
		// Redirects after signing out must not leave old pages in the Back menu.
		preview.once( 'did-stop-loading', () => {
			if ( ! preview.isDestroyed() ) preview.navigationHistory.clear();
		} );
		preview.reload();
	}
}
