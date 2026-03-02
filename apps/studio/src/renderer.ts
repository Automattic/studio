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
import { __ } from '@wordpress/i18n';
import { createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Root from 'src/components/root';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { initEnabledAddons } from 'src/modules/addons/registry';

// Enhances Sentry breadcrumbs messages by extracting meaningful information from DOM elements
const getExtraSentryBreadcrumbs = ( targetElement: HTMLElement ) => {
	// Check for custom data-sentry attribute first, which is used for elements
	// that need explicit tracking identification
	const sentryData = targetElement.getAttribute( 'data-sentry' );
	if ( sentryData ) {
		return `[data-sentry="${ sentryData }"]`;
	}

	// Skip adding extra context if aria-label is present, as it already provides
	// sufficient identification for both tracking and accessibility
	if ( targetElement.getAttribute( 'aria-label' ) ) {
		return '';
	}

	// Fall back to the element's text content if available
	const textContent = targetElement.textContent?.trim() || targetElement.innerText?.trim();
	if ( textContent ) {
		return `[text-content="${ textContent }"]`;
	}

	// If no identifying information is found on the target element,
	// traverse up the DOM tree looking for identifiable parent elements.
	// This helps with SVG icons or other elements wrapped in interactive parents.
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

Sentry.init( {
	debug: true,
	beforeBreadcrumb( breadcrumb, hint ) {
		const targetElement = hint?.event?.target;

		if ( breadcrumb.category === 'ui.click' && targetElement ) {
			breadcrumb.message =
				( breadcrumb.message || '' ) + getExtraSentryBreadcrumbs( targetElement );
		}

		return breadcrumb;
	},
} );

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

void Promise.all( [
	getIpcApi().getAppGlobals(),
	getIpcApi().getSentryUserId(),
	getIpcApi().getEnabledAddonIds(),
] ).then( ( [ appGlobals, sentryUserId, enabledAddonIds ] ) => {
	// Ensure the app globals are available before any renderer code starts running
	window.appGlobals = appGlobals;
	initEnabledAddons( enabledAddonIds );

	// Show warning if running an ARM64 translator
	if ( appGlobals.arm64Translation && ! localStorage.getItem( 'dontShowARM64Warning' ) ) {
		const showARM64MessageBox = async () => {
			const platformMessages: Record< string, string > = {
				darwin: __(
					'Downloading the Apple Silicon Chip version of Studio will provide better performance.'
				),
				win32: __( 'Downloading the ARM version of Studio will provide better performance.' ),
			};

			const detailMessage =
				platformMessages[ window.appGlobals.platform ] ||
				__( 'Downloading the optimized version of Studio will provide better performance.' );

			const { response, checkboxChecked } = await getIpcApi().showMessageBox( {
				type: 'warning',
				message: __( 'This version of Studio is not optimized for your computer' ),
				detail: detailMessage,
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

		void showARM64MessageBox();
	}

	Sentry.setUser( { id: sentryUserId } );

	const rootEl = document.getElementById( 'root' );
	if ( rootEl ) {
		const root = createRoot( rootEl );
		root.render( createElement( StrictMode, null, createElement( Root ) ) );
	}
} );
