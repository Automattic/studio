import {
	app,
	BrowserWindow,
	ipcMain,
	session,
	type IpcMainInvokeEvent,
	globalShortcut,
	Menu,
} from 'electron';
import path from 'path';
import * as Sentry from '@sentry/electron/main';
import { __, defaultI18n } from '@wordpress/i18n';
import packageJson from '../package.json';
import * as ipcHandlers from './ipc-handlers';
import { bumpAggregatedUniqueStat } from './lib/bump-stats';
import { getLocaleData, getSupportedLocale } from './lib/locale';
import { PROTOCOL_PREFIX, handleAuthCallback, setupAuthCallbackHandler } from './lib/oauth';
import { setupLogging } from './logging';
import { createMainWindow } from './main-window';
import {
	migrateFromWpNowFolder,
	needsToMigrateFromWpNowFolder,
} from './migrations/migrate-from-wp-now-folder';
import setupWPServerFiles from './setup-wp-server-files';
import { setupUpdates } from './updates';
import { stopAllServersOnQuit } from './site-server'; // eslint-disable-line import/order

Sentry.init( {
	dsn: 'https://97693275b2716fb95048c6d12f4318cf@o248881.ingest.sentry.io/4506612776501248',
	debug: true,
	enabled: process.env.NODE_ENV !== 'development',
	release: COMMIT_HASH,
} );

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const isInInstaller = require( 'electron-squirrel-startup' );

// Ensure we're the only instance of the app running
const gotTheLock = app.requestSingleInstanceLock();

if ( gotTheLock && ! isInInstaller ) {
	appBoot();
}

const onAuthorizationCallback = ( mainWindow: BrowserWindow | null, url: string ) => {
	if ( mainWindow ) {
		const { host, hash } = new URL( url );
		if ( host === 'auth' ) {
			handleAuthCallback( hash ).then( ( authResult ) => {
				if ( authResult instanceof Error ) {
					ipcMain.emit( 'auth-callback', null, { error: authResult } );
				} else {
					ipcMain.emit( 'auth-callback', null, { token: authResult } );
				}
			} );
		}
	}
};

async function appBoot() {
	let mainWindow: BrowserWindow | null = null;

	const locale = getSupportedLocale();
	const localeData = getLocaleData( locale );
	defaultI18n.setLocaleData( localeData?.locale_data?.messages );

	app.setName( packageJson.productName );

	Menu.setApplicationMenu( null );

	setupLogging();

	setupUpdates();

	setupWPServerFiles().catch( Sentry.captureException );

	if ( process.defaultApp ) {
		if ( process.argv.length >= 2 ) {
			app.setAsDefaultProtocolClient( PROTOCOL_PREFIX, process.execPath, [
				path.resolve( process.argv[ 1 ] ),
			] );
		}
	} else {
		app.setAsDefaultProtocolClient( PROTOCOL_PREFIX );
	}

	// Forces all renderers to be sandboxed. IPC is the only way render processes will
	// be able to perform privileged operations.
	app.enableSandbox();

	// Prevent navigation to anywhere other than known locations
	app.on( 'web-contents-created', ( _event, contents ) => {
		contents.on( 'will-navigate', ( event, navigationUrl ) => {
			const { origin } = new URL( navigationUrl );
			const allowedOrigins = [ new URL( MAIN_WINDOW_WEBPACK_ENTRY ).origin ];
			if ( ! allowedOrigins.includes( origin ) ) {
				event.preventDefault();
			}
		} );
		contents.setWindowOpenHandler( () => {
			return { action: 'deny' };
		} );
	} );

	function validateIpcSender( event: IpcMainInvokeEvent ) {
		if ( new URL( event.senderFrame.url ).origin === new URL( MAIN_WINDOW_WEBPACK_ENTRY ).origin ) {
			return true;
		}

		throw new Error( 'Failed IPC sender validation check: ' + event.senderFrame.url );
	}

	function setupIpc() {
		for ( const [ key, handler ] of Object.entries( ipcHandlers ) ) {
			if ( typeof handler === 'function' && key !== 'logRendererMessage' ) {
				ipcMain.handle( key, function ( event, ...args ) {
					try {
						validateIpcSender( event );

						// Invoke the handler. Param types have already been type checked by code in ipc-types.d.ts,
						// so we can safetly ignore the handler function's param types here.
						return ( handler as any )( event, ...args ); // eslint-disable-line @typescript-eslint/no-explicit-any
					} catch ( error ) {
						console.error( error );
						throw error;
					}
				} );
			}

			// logRendererMessage is handled specially because it uses the (hopefully more efficient)
			// fire-and-forget .send method instead of .invoke
			if ( typeof handler === 'function' && key === 'logRendererMessage' ) {
				ipcMain.on( key, function ( event, level, ...args ) {
					try {
						validateIpcSender( event );
						handler( event, level as never, ...args );
					} catch ( error ) {
						console.error( error );
						throw error;
					}
				} );
			}
		}
	}

	function setupCustomProtocolHandler() {
		if ( process.platform === 'darwin' ) {
			app.on( 'open-url', ( _event, url ) => {
				onAuthorizationCallback( mainWindow, url );
			} );
		} else {
			// Handle custom protocol links on Windows and Linux
			app.on( 'second-instance', ( _event, argv ): void => {
				if ( mainWindow ) {
					if ( mainWindow.isMinimized() ) mainWindow.restore();
					mainWindow.focus();

					const customProtocolParameter = argv?.find( ( arg ) =>
						arg.startsWith( PROTOCOL_PREFIX )
					);
					if ( customProtocolParameter ) {
						onAuthorizationCallback( mainWindow, customProtocolParameter );
					}
				}
			} );
		}
	}

	function handleAuthOnStartup() {
		if ( process.argv.length > 1 ) {
			const argv = process.argv;
			const customProtocolParameter = argv?.find( ( arg ) => arg.startsWith( PROTOCOL_PREFIX ) );
			if ( customProtocolParameter ) {
				onAuthorizationCallback( mainWindow, customProtocolParameter );
			}
		}
	}

	app.on( 'ready', async () => {
		console.log( `App version: ${ app.getVersion() }` );
		console.log( `Built from commit: ${ COMMIT_HASH ?? 'undefined' }` );
		console.log( `Local timezone: ${ Intl.DateTimeFormat().resolvedOptions().timeZone }` );
		console.log( `App locale: ${ app.getLocale() }` );
		console.log( `System locale: ${ app.getSystemLocale() }` );
		console.log( `Preferred languages: ${ app.getPreferredSystemLanguages() }` );
		console.log( `Used language: ${ getSupportedLocale() }` );

		// By default Electron automatically approves all permissions requests (e.g. notifications, webcam)
		// We'll opt-in to permissions we specifically need instead.
		session.defaultSession.setPermissionRequestHandler( ( webContents, permission, callback ) => {
			// Reject all permission requests
			callback( false );
		} );

		session.defaultSession.webRequest.onHeadersReceived( ( details, callback ) => {
			// Only set a custom CSP header the main window UI. For other pages (like login) we should
			// use the CSP provided by the server, which is more likely to be up-to-date and complete.
			if ( details.url !== MAIN_WINDOW_WEBPACK_ENTRY ) {
				callback( details );
				return;
			}

			const basePolicies = [
				"default-src 'self'", // Allow resources from these domains
				"script-src-attr 'none'",
				"img-src 'self' https://*.gravatar.com https://*.wp.com data:",
				"style-src 'self' 'unsafe-inline'", // unsafe-inline used by tailwindcss in development, and also in production after the app rename
			];
			const prodPolicies = [ "connect-src 'self' https://public-api.wordpress.com" ];
			const devPolicies = [
				// Webpack uses eval in development, react-devtools uses localhost
				"script-src 'self' 'unsafe-eval' 'unsafe-inline' data: http://localhost:*",
				// react-devtools uses localhost
				"connect-src 'self' https://public-api.wordpress.com ws://localhost:*",
			];
			const policies = [
				...basePolicies,
				...( process.env.NODE_ENV === 'development' ? devPolicies : prodPolicies ),
			];

			callback( {
				...details,
				responseHeaders: {
					...details.responseHeaders,
					'Content-Security-Policy': [ policies.filter( Boolean ).join( '; ' ) ],
				},
			} );
		} );

		if ( await needsToMigrateFromWpNowFolder() ) {
			await migrateFromWpNowFolder();
		}

		setupIpc();
		setupCustomProtocolHandler();

		mainWindow = createMainWindow();
		setupAuthCallbackHandler( mainWindow );
		handleAuthOnStartup();

		bumpAggregatedUniqueStat( 'local-environment-launch-uniques', process.platform, 'weekly' );
	} );

	// Quit when all windows are closed, except on macOS. There, it's common
	// for applications and their menu bar to stay active until the user quits
	// explicitly with Cmd + Q.
	app.on( 'window-all-closed', () => {
		if ( process.platform !== 'darwin' ) {
			app.quit();
		}
	} );

	app.on( 'will-quit', () => {
		globalShortcut.unregisterAll();
	} );

	app.on( 'quit', () => {
		stopAllServersOnQuit();
	} );

	app.on( 'activate', () => {
		// On OS X it's common to re-create a window in the app when the
		// dock icon is clicked and there are no other windows open.
		if ( BrowserWindow.getAllWindows().length === 0 && app.isReady() ) {
			mainWindow = createMainWindow();
		}
	} );
}
