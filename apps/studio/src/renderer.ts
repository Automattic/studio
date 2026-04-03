/**
 * This file will automatically be loaded by webpack and run in the "renderer" context.
 * To learn more about the differences between the "main" and the "renderer" context in
 * Electron, visit:
 *
 * https://electronjs.org/docs/latest/tutorial/process-model
 *
 * By default, Node.js integration in this file is disabled. When enabling Node.js integration
 * in a renderer process, please be aware of potential security implications. You can read
 * more about security risks here:
 *
 * https://electronjs.org/docs/tutorial/security
 *
 * To enable Node.js integration in this file, open up `main.mjs` and enable the `nodeIntegration`
 * flag:
 *
 * ```
 *  // Create the browser window.
 *  mainWindow = new BrowserWindow({
 *    width: 800,
 *    height: 600,
 *    webPreferences: {
 *      nodeIntegration: true
 *    }
 *  });
 * ```
 */

import { createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import AddSiteRoot from 'src/components/new-ui/add-site-root';
import SettingsRoot from 'src/components/new-ui/settings-root';
import Root from 'src/components/root';
import { getIpcApi } from 'src/lib/get-ipc-api';

const view = new URLSearchParams( window.location.search ).get( 'view' );
const RootComponent = view === 'settings' ? SettingsRoot : view === 'add-site' ? AddSiteRoot : Root;

void getIpcApi()
	.getAppGlobals()
	.then( ( appGlobals ) => {
		window.appGlobals = appGlobals;

		const rootEl = document.getElementById( 'root' );
		if ( rootEl ) {
			const root = createRoot( rootEl );
			root.render( createElement( StrictMode, null, createElement( RootComponent ) ) );
		}
	} );
