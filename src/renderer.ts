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
 * To enable Node.js integration in this file, open up `main.js` and enable the `nodeIntegration`
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

import { createRoot } from 'react-dom/client';
import { createElement, StrictMode } from 'react';
import Root from './components/root';
import { getIpcApi } from './lib/get-ipc-api';
import * as Sentry from '@sentry/electron/renderer';
import { init as reactInit } from '@sentry/react';
import './index.css';

Sentry.init( { debug: true }, reactInit );

const makeLogger =
	( level: 'info' | 'warn' | 'erro', originalLogger: typeof console.log ) =>
	( ...args: Parameters< typeof console.log > ) => {
		// Map Error objects to strings so we can preserve their stack trace
		const mappedErrors = args.map( ( arg ) =>
			arg instanceof Error && arg.stack ? arg.stack : arg
		);

		getIpcApi().logRendererMessage( level, ...mappedErrors );
		originalLogger( ...args );
	};

console.log = makeLogger( 'info', console.log.bind( console ) );
console.warn = makeLogger( 'warn', console.warn.bind( console ) );
console.error = makeLogger( 'erro', console.error.bind( console ) );

const originalOnerror = window.onerror?.bind( window );
window.onerror = ( ...args ) => {
	originalOnerror?.( ...args );

	const [ , , , , error ] = args;
	getIpcApi().logRendererMessage(
		'erro',
		'Uncaught error in window.onerror',
		error?.stack || error
	);
};

const originalOnunhandledrejection = window.onunhandledrejection?.bind( window );
window.onunhandledrejection = ( event ) => {
	originalOnunhandledrejection?.( event );

	getIpcApi().logRendererMessage(
		'erro',
		'Unhandled promise rejection in window.onunhandledrejection',
		event.reason instanceof Error && event.reason.stack ? event.reason.stack : event.reason
	);
};

const rootEl = document.getElementById( 'root' );
if ( rootEl ) {
	const root = createRoot( rootEl );
	root.render( createElement( StrictMode, null, createElement( Root ) ) );
}
