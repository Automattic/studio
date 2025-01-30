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

import * as Sentry from '@sentry/electron/renderer';
import { init as reactInit } from '@sentry/react';
import { __ } from '@wordpress/i18n';
import { createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Root from './components/root';
import { getIpcApi } from './lib/get-ipc-api';
import './index.css';

Sentry.init(
	{
		debug: true,
		beforeBreadcrumb( breadcrumb, hint ) {
			if ( breadcrumb.category === 'ui.click' ) {
				const targetElement = hint?.event?.target;

				if ( targetElement ) {
					// improve breadcrumb message, since sometimes we don't have any valuable information in the clicked element
					const getExtraInformation = () => {
						// if some clicked element doesn't have any valuable information, we can use data-sentry attribute to identify it
						// but if button doesn't have textContent or any other information, prefer to always add area-label, since it's useful for screen-readers.
						// data-sentry should be used only in edge-cases
						const sentryData = targetElement.getAttribute( 'data-sentry' );
						if ( sentryData ) {
							return `[data-sentry="${ sentryData }"]`;
						}

						// area-label is added by default to message, so we don't need to add it again or any extra information, typically it's enough information to identify the element
						if ( targetElement.getAttribute( 'aria-label' ) ) {
							return '';
						}

						const textContent =
							targetElement.textContent?.trim() || targetElement.innerText?.trim();
						if ( textContent ) {
							return `[text-content="${ textContent }"]`;
						}

						// Last resort, for example in cases when click happened on svg which doesn't have any information, but area-label or data-sentry or textContent is located in parent <a> or <button> tag
						let element = targetElement.parentElement;
						while ( element ) {
							const ariaLabel = element.getAttribute( 'aria-label' );
							const sentryData = element.getAttribute( 'data-sentry' );
							const textContent = element.textContent?.trim() || element.innerText?.trim();
							if ( ariaLabel ) {
								return `[parent-aria-label="${ ariaLabel }"]`;
							}
							if ( sentryData ) {
								return `[parent-data-sentry="${ sentryData }"]`;
							}
							if ( textContent ) {
								return `[parent-text-content="${ textContent }"]`;
							}
							element = element.parentElement;
						}

						return '';
					};

					breadcrumb.message = ( breadcrumb.message || '' ) + getExtraInformation();
				}
			}

			return breadcrumb;
		},
	},
	reactInit
);

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

getIpcApi()
	.getAppGlobals()
	.then( ( appGlobals ) => {
		// Ensure the app globals are available before any renderer code starts running
		window.appGlobals = appGlobals;

		// Show warning if running an ARM64 translator
		if (
			appGlobals.platform === 'darwin' &&
			appGlobals.arm64Translation &&
			! localStorage.getItem( 'dontShowARM64Warning' )
		) {
			const showARM64MessageBox = async () => {
				const { response, checkboxChecked } = await getIpcApi().showMessageBox( {
					type: 'warning',
					message: __( 'This version of Studio is not optimized for your computer' ),
					detail:
						window.appGlobals.platform === 'darwin'
							? __(
									'Downloading the Mac with Apple Silicon Chip version of Studio will provide better performance.'
							  )
							: __(
									'Downloading the optimized version of Studio will provide better performance.'
							  ),
					checkboxLabel: __( "Don't show this warning again" ),
					buttons: [ __( 'Download' ), __( 'Not now' ) ],
					cancelId: 1,
				} );

				if ( checkboxChecked ) {
					localStorage.setItem( 'dontShowARM64Warning', 'true' );
				}

				switch ( response ) {
					case 0:
						// Open Download link
						getIpcApi().openURL( `https://developer.wordpress.com/studio/` );
						break;
					case 1:
						// User clicked Cancel
						break;
					default:
						break;
				}
			};

			showARM64MessageBox();
		}

		const rootEl = document.getElementById( 'root' );
		if ( rootEl ) {
			const root = createRoot( rootEl );
			root.render( createElement( StrictMode, null, createElement( Root ) ) );
		}
	} );
