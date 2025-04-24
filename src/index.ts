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
import { StatsGroup } from 'common/types/stats';
import { PROTOCOL_PREFIX } from 'src/constants';
import * as ipcHandlers from 'src/ipc-handlers';
import { hasActiveSyncOperations } from 'src/lib/active-sync-operations';
import { bumpAggregatedUniqueStat, bumpStat } from 'src/lib/bump-stats';
import { getPlatformMetric } from 'src/lib/bump-stats/lib';
import {
	listenCLICommands,
	getCLIDataForMainInstance,
	isCLI,
	processCLICommand,
	executeCLICommand,
} from 'src/lib/cli';
import { getUserLocaleWithFallback } from 'src/lib/locale-node';
import { onOpenUrlCallback } from 'src/lib/oauth';
import { stopProxyServer } from 'src/lib/proxy-server';
import { getSentryReleaseInfo } from 'src/lib/sentry-release';
import { startUserDataWatcher, stopUserDataWatcher } from 'src/lib/user-data-watcher';
import { setupLogging } from 'src/logging';
import { createMainWindow, getMainWindow } from 'src/main-window';
import {
	needsToMigrateFromWpNowFolder,
	migrateFromWpNowFolder,
} from 'src/migrations/migrate-from-wp-now-folder';
import { migrateAllDatabasesInSitu } from 'src/migrations/move-databases-in-situ';
import { removeSitesWithEmptyDirectories } from 'src/migrations/remove-sites-with-empty-dirs';
import { installCLIOnWindows } from 'src/modules/cli/lib/install-windows';
import { isCLIFeatureEnabled } from 'src/modules/cli/lib/is-cli-feature-enabled';
import { setupWPServerFiles, updateWPServerFiles } from 'src/setup-wp-server-files';
import { stopAllServersOnQuit } from 'src/site-server';
import { loadUserData, saveUserData } from 'src/storage/user-data';
import { setupUpdates } from 'src/updates';
// eslint-disable-next-line import/order
import packageJson from '../package.json';

if ( ! isCLI() && ! process.env.IS_DEV_BUILD ) {
	const { sentryRelease, isDevEnvironment } = getSentryReleaseInfo( app.getVersion() );

	Sentry.init( {
		dsn: 'https://97693275b2716fb95048c6d12f4318cf@o248881.ingest.sentry.io/4506612776501248',
		debug: true,
		enabled: ! isDevEnvironment,
		release: sentryRelease,
		environment: isDevEnvironment ? 'development' : 'production',
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

async function setupSentryUserId() {
	const userData = await loadUserData();

	if ( ! userData.sentryUserId ) {
		userData.sentryUserId = crypto.randomUUID();
		console.log( Date.now(), 'Saving sentry user ID', userData.sentryUserId );
		await saveUserData( userData );
	}

	console.log( 'Setting Sentry user ID:', userData.sentryUserId );
	Sentry.setUser( { id: userData.sentryUserId } );
}

async function appBoot() {
	app.setName( packageJson.productName );

	Menu.setApplicationMenu( null );

	setupCustomProtocolHandler();

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
			const prodPolicies = [
				"connect-src 'self' https://public-api.wordpress.com https://api.wordpress.org",
			];
			const devPolicies = [
				// Webpack uses eval in development, react-devtools uses localhost
				"script-src 'self' 'unsafe-eval' 'unsafe-inline' data: http://localhost:*",
				// react-devtools uses localhost
				"connect-src 'self' https://public-api.wordpress.com https://api.wordpress.org ws://localhost:*",
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

		await setupSentryUserId();

		await removeSitesWithEmptyDirectories();

		await migrateAllDatabasesInSitu();

		createMainWindow();
		startUserDataWatcher();

		// Handle CLI commands
		listenCLICommands();
		executeCLICommand();

		const userData = await loadUserData();
		// Bump stats for the first time the app runs - this is when no lastBumpStats are available
		if ( ! userData.lastBumpStats ) {
			bumpStat( StatsGroup.STUDIO_APP_LAUNCH, getPlatformMetric( process.platform ) );
		}

		// Bump a stat on each app launch, approximates total app launches
		bumpStat( StatsGroup.STUDIO_APP_LAUNCH_TOTAL, getPlatformMetric( process.platform ) );
		// Bump stat for unique weekly app launch, approximates weekly active users
		bumpAggregatedUniqueStat(
			StatsGroup.STUDIO_APP_LAUNCH_UNIQUE,
			getPlatformMetric( process.platform ),
			'weekly'
		);

		if ( isCLIFeatureEnabled() ) {
			await installCLIOnWindows();
		}

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
		stopProxyServer().catch( ( error ) => console.error( 'Error stopping proxy server:', error ) );
		stopUserDataWatcher();
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
