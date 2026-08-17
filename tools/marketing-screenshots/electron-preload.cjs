const { contextBridge, ipcRenderer } = require( 'electron' );

contextBridge.exposeInMainWorld( 'ipcApi', {
	setWebviewViewport: ( webContentsId, viewport ) =>
		ipcRenderer.invoke( 'setWebviewViewport', webContentsId, viewport ),
} );
