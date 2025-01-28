import {
	app,
	BrowserWindow,
	ipcMain,
	session,
	type IpcMainInvokeEvent,
	globalShortcut,
	Menu,
	dialog,
} from 'electron';
import path from 'path';
import * as Sentry from '@sentry/electron/main';
import { __ } from '@wordpress/i18n';
import packageJson from '../package.json';
import { PROTOCOL_PREFIX } from './constants';
import * as ipcHandlers from './ipc-handlers';
import { hasActiveSyncOperations } from './lib/active-sync-operations';
import { getPlatformName } from './lib/app-globals';
import { bumpAggregatedUniqueStat, bumpStat } from './lib/bump-stats';
import {
	listenCLICommands,
	getCLIDataForMainInstance,
	isCLI,
	processCLICommand,
	executeCLICommand,
} from './lib/cli';
import { getUserLocaleWithFallback } from './lib/locale-node';
import { handleAuthCallback, setUpAuthCallbackHandler } from './lib/oauth';
import { setupLogging } from './logging';
import { createMainWindow, getMainWindow } from './main-window';
import {
	migrateFromWpNowFolder,
	needsToMigrateFromWpNowFolder,
} from './migrations/migrate-from-wp-now-folder';
import { setupWPServerFiles, updateWPServerFiles } from './setup-wp-server-files';
import { stopAllServersOnQuit } from './site-server';
import { loadUserData } from './storage/user-data'; // eslint-disable-next-line import/order
import { setupUpdates } from './updates';

if ( ! isCLI() && ! process.env.IS_DEV_BUILD ) {
	Sentry.init( {
		dsn: 'https://97693275b2716fb95048c6d12f4318cf@o248881.ingest.sentry.io/4506612776501248',
		debug: true,
		enabled: process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test',
		release: `${ app.getVersion() ? app.getVersion() : COMMIT_HASH }-${ getPlatformName() }`,
	} );
}

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const isInInstaller = require( 'electron-squirrel-startup' );

// Ensure we're the only instance of the app running
const gotTheLock = app.requestSingleInstanceLock( getCLIDataForMainInstance() );

let finishedInitialization = false;

if ( gotTheLock && ! isInInstaller ) {
	if ( isCLI() ) {
		processCLICommand( { mainInstance: true, appBoot } );
	} else {
		appBoot();
	}
} else if ( ! gotTheLock ) {
	if ( isCLI() ) {
		processCLICommand( { mainInstance: false } );
	} else {
		app.quit();
	}
}

const onOpenUrlCallback = async ( url: string ) => {
	const urlObject = new URL( url );
	const { host, hash, searchParams } = urlObject;
	if ( host === 'auth' ) {
		handleAuthCallback( hash ).then( ( authResult ) => {
			if ( authResult instanceof Error ) {
				ipcMain.emit( 'auth-callback', null, { error: authResult } );
			} else {
				ipcMain.emit( 'auth-callback', null, { token: authResult } );
			}
		} );
	}

	if ( host === 'sync-connect-site' ) {
		const remoteSiteId = parseInt( searchParams.get( 'remoteSiteId' ) ?? '' );
		const studioSiteId = searchParams.get( 'studioSiteId' );
		if ( remoteSiteId && studioSiteId ) {
			const mainWindow = await getMainWindow();
			mainWindow.webContents.send( 'sync-connect-site', { remoteSiteId, studioSiteId } );
		}
	}
};

async function appBoot() {
	app.setName( packageJson.productName );

	Menu.setApplicationMenu( null );

	setupCustomProtocolHandler();

	setUpAuthCallbackHandler();

	setupLogging();

	setupUpdates();

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
		if ( ! event.senderFrame ) {
			throw new Error(
				'Failed IPC sender validation check: the frame has either navigated or been destroyed'
			);
		}

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
						( handler as typeof ipcHandlers.logRendererMessage )( event, level as never, ...args );
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
				onOpenUrlCallback( url );
			} );
		} else {
			// Handle custom protocol links on Windows and Linux
			app.on( 'second-instance', async ( _event, argv ) => {
				if ( ! finishedInitialization ) {
					return;
				}

				const mainWindow = await getMainWindow();
				// CLI commands are likely invoked from other apps, so we need to avoid changing app focus.
				const isCLI = argv?.find( ( arg ) => arg.startsWith( '--cli=' ) );
				if ( ! isCLI ) {
					if ( mainWindow.isMinimized() ) mainWindow.restore();
					mainWindow.focus();
				}

				const customProtocolParameter = argv?.find( ( arg ) => arg.startsWith( PROTOCOL_PREFIX ) );
				if ( customProtocolParameter ) {
					await onOpenUrlCallback( customProtocolParameter );
				}
			} );
		}
	}

	app.on( 'ready', async () => {
		const locale = await getUserLocaleWithFallback();

		console.log( `App version: ${ app.getVersion() }` );
		console.log( `Built from commit: ${ COMMIT_HASH ?? 'undefined' }` );
		console.log( `Local timezone: ${ Intl.DateTimeFormat().resolvedOptions().timeZone }` );
		console.log( `App locale: ${ app.getLocale() }` );
		console.log( `System locale: ${ app.getSystemLocale() }` );
		console.log( `Used language: ${ locale }` );

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
				"script-src 'self' 'wasm-unsafe-eval'", // allow WebAssembly to compile and instantiate
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

		setupIpc();

		await setupWPServerFiles().catch( Sentry.captureException );
		// WordPress server files are updated asynchronously to avoid delaying app initialization
		updateWPServerFiles().catch( Sentry.captureException );

		if ( await needsToMigrateFromWpNowFolder() ) {
			await migrateFromWpNowFolder();
		}

		createMainWindow();

		// Handle CLI commands
		listenCLICommands();
		executeCLICommand();

		// Bump stats for the first time the app runs - this is when no lastBumpStats are available
		const userData = await loadUserData();
		if ( ! userData.lastBumpStats ) {
			bumpStat( 'studio-app-launch-first', process.platform );
		}

		// Bump a stat on each app launch, approximates total app launches
		bumpStat( 'studio-app-launch-total', process.platform );
		// Bump stat for unique weekly app launch, approximates weekly active users
		bumpAggregatedUniqueStat( 'local-environment-launch-uniques', process.platform, 'weekly' );

		finishedInitialization = true;
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

	app.on( 'before-quit', ( event ) => {
		if ( ! hasActiveSyncOperations() ) {
			return;
		}

		const QUIT_APP_BUTTON_INDEX = 0;
		const CANCEL_BUTTON_INDEX = 1;

		const clickedButtonIndex = dialog.showMessageBoxSync( {
			message: __( 'Sync in progress' ),
			detail: __(
				'There’s a sync operation in progress. Quitting the app will abort that operation. Are you sure you want to quit?'
			),
			buttons: [ __( 'Yes, quit the app' ), __( 'No, take me back' ) ],
			cancelId: CANCEL_BUTTON_INDEX,
			defaultId: QUIT_APP_BUTTON_INDEX,
			type: 'warning',
		} );

		if ( clickedButtonIndex === CANCEL_BUTTON_INDEX ) {
			event.preventDefault();
		}
	} );

	app.on( 'quit', () => {
		stopAllServersOnQuit();
	} );

	app.on( 'activate', () => {
		if ( ! finishedInitialization ) {
			return;
		}

		if ( BrowserWindow.getAllWindows().length === 0 ) {
			// On OS X it's common to re-create a window in the app when the
			// dock icon is clicked and there are no other windows open.
			createMainWindow();
		}
	} );
}
