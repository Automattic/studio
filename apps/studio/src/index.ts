import {
	app,
	BrowserWindow,
	ipcMain,
	session,
	type IpcMainInvokeEvent,
	globalShortcut,
	Menu,
	dialog,
	MessageBoxSyncOptions,
} from 'electron';
import path from 'path';
import { pathToFileURL } from 'url';
import * as Sentry from '@sentry/electron/main';
import { PROTOCOL_PREFIX } from '@studio/common/constants';
import { runMigrations } from '@studio/common/lib/migration';
import { suppressPunycodeWarning } from '@studio/common/lib/suppress-punycode-warning';
import { __, _n, sprintf } from '@wordpress/i18n';
import {
	installExtension,
	REACT_DEVELOPER_TOOLS,
	REDUX_DEVTOOLS,
} from 'electron-devtools-installer';
import { IPC_VOID_HANDLERS } from 'src/constants';
import * as ipcHandlers from 'src/ipc-handlers';
import {
	hasActiveSyncOperations,
	hasUploadingPushOperations,
} from 'src/lib/active-sync-operations';
import {
	bumpStat,
	bumpAggregatedUniqueStat,
	getPlatformMetric,
	StatsGroup,
} from 'src/lib/bump-stats';
import { handleDeeplink } from 'src/lib/deeplink';
import { getUserLocaleWithFallback } from 'src/lib/locale-node';
import { getSentryReleaseInfo } from 'src/lib/sentry-release';
import { startUserDataWatcher, stopUserDataWatcher } from 'src/lib/user-data-watcher';
import { setupLogging } from 'src/logging';
import { createMainWindow, getMainWindow } from 'src/main-window';
import { migrateAppdataMigration } from 'src/migrations/migrate-appdata-via-cli';
import {
	needsToMigrateFromWpNowFolder,
	migrateFromWpNowFolder,
} from 'src/migrations/migrate-from-wp-now-folder';
import { renameLaunchUniquesStat } from 'src/migrations/rename-launch-uniques-stat';
import {
	startCliEventsSubscriber,
	stopCliEventsSubscriber,
} from 'src/modules/cli/lib/cli-events-subscriber';
import { isStudioCliInstalled } from 'src/modules/cli/lib/ipc-handlers';
import { updateWindowsCliVersionedPathIfNeeded } from 'src/modules/cli/lib/windows-installation-manager';
import { setupWPServerFiles, updateWPServerFiles } from 'src/setup-wp-server-files';
import { getRunningSiteCount, SiteServer, stopAllServers } from 'src/site-server';
import {
	loadUserData,
	lockAppdata,
	saveUserData,
	unlockAppdata,
	updateAppdata,
} from 'src/storage/user-data';
import { getAutoUpdaterState, setupUpdates } from 'src/updates';
// eslint-disable-next-line import-x/order
import packageJson from '../package.json';

// Helper function to get the actual URL for validation
function getRendererUrl(): string {
	if ( ! app.isPackaged && process.env[ 'ELECTRON_RENDERER_URL' ] ) {
		return process.env[ 'ELECTRON_RENDERER_URL' ];
	} else {
		// For production file paths, convert to file:// URL
		return pathToFileURL( path.join( __dirname, '../renderer/index.html' ) ).href;
	}
}

if ( ! process.env.IS_DEV_BUILD ) {
	const { sentryRelease, isDevEnvironment } = getSentryReleaseInfo( app.getVersion() );

	Sentry.init( {
		dsn: 'https://97693275b2716fb95048c6d12f4318cf@o248881.ingest.sentry.io/4506612776501248',
		debug: true,
		enabled: ! isDevEnvironment,
		release: sentryRelease,
		environment: isDevEnvironment ? 'development' : 'production',
	} );
}

suppressPunycodeWarning();

const isInInstaller = require( 'electron-squirrel-startup' );

// Ensure we're the only instance of the app running
const gotTheLock = app.requestSingleInstanceLock();

let finishedInitialization = false;

if ( gotTheLock && ! isInInstaller ) {
	void appBoot();
} else if ( ! gotTheLock ) {
	app.quit();
}

async function setupSentryUserId() {
	try {
		await lockAppdata();
		const userData = await loadUserData();
		if ( ! userData.sentryUserId ) {
			userData.sentryUserId = crypto.randomUUID();
		}

		console.log( 'Setting Sentry user ID:', userData.sentryUserId );
		Sentry.setUser( { id: userData.sentryUserId } );

		await saveUserData( userData );
	} finally {
		await unlockAppdata();
	}
}

// This is a workaround to ensure that the extension background workers are started
// If you are updating Electron, confirm if this is still needed
// https://github.com/electron/electron/issues/41613
function launchExtensionBackgroundWorkers( appSession = session.defaultSession ) {
	const extensionApi = ( appSession.extensions as Electron.Extensions | undefined ) || appSession;
	return Promise.all(
		extensionApi.getAllExtensions().map( async ( extension ) => {
			const manifest = extension.manifest;
			if ( manifest.manifest_version === 3 && manifest?.background?.service_worker ) {
				await appSession.serviceWorkers.startWorkerForScope( extension.url );
			}
		} )
	);
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
			const allowedOrigins = [ new URL( getRendererUrl() ).origin ];
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

		if ( new URL( event.senderFrame.url ).origin === new URL( getRendererUrl() ).origin ) {
			return true;
		}

		throw new Error( 'Failed IPC sender validation check: ' + event.senderFrame.url );
	}

	function setupIpc() {
		const ipcHandlerEntries = Object.entries( ipcHandlers ) as [
			keyof typeof ipcHandlers,
			( ...args: unknown[] ) => unknown,
		][];

		for ( const [ key, handler ] of ipcHandlerEntries ) {
			if ( IPC_VOID_HANDLERS.find( ( handler ) => handler === key ) ) {
				ipcMain.on( key, function ( event, ...args: unknown[] ) {
					try {
						validateIpcSender( event );
						handler( event, ...args );
					} catch ( error ) {
						console.error( error );
						throw error;
					}
				} );
			} else {
				ipcMain.handle( key, function ( event, ...args: unknown[] ) {
					try {
						validateIpcSender( event );
						return handler( event, ...args );
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
				void handleDeeplink( url );
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
					void handleDeeplink( customProtocolParameter );
				}
			} );
		}
	}

	app.on( 'ready', async () => {
		const locale = await getUserLocaleWithFallback();
		if ( process.env.NODE_ENV === 'development' ) {
			await installExtension( REACT_DEVELOPER_TOOLS );
			await installExtension( REDUX_DEVTOOLS );
			await launchExtensionBackgroundWorkers();
		}

		console.log( `App version: ${ app.getVersion() }` );
		console.log( `Environment: ${ process.env.NODE_ENV ?? 'undefined' }` );
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
			if ( details.url !== getRendererUrl() ) {
				callback( details );
				return;
			}

			const basePolicies = [
				"default-src 'self'", // Allow resources from these domains
				"script-src-attr 'none'",
				"img-src 'self' https://*.gravatar.com https://*.wp.com https://blueprintlibrary.wordpress.com data:",
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

		await runMigrations( [ migrateAppdataMigration ] ).catch( Sentry.captureException );

		if ( await needsToMigrateFromWpNowFolder() ) {
			await migrateFromWpNowFolder();
		}

		await setupSentryUserId();

		await renameLaunchUniquesStat();

		// Fetch data from CLI and subscribe to CLI events before starting the user data
		// watcher. The watcher can trigger getMainWindow() which creates the window early,
		// so sites must be loaded first.
		await SiteServer.fetchAll();
		await startCliEventsSubscriber();

		await startUserDataWatcher();

		await createMainWindow();

		const userData = await loadUserData();
		// Bump stats for the first time the app runs - this is when no lastBumpStats are available
		if ( ! userData.lastBumpStats ) {
			bumpStat( StatsGroup.STUDIO_APP_LAUNCH, getPlatformMetric() );
		}

		// Bump a stat on each app launch, approximates total app launches
		bumpStat( StatsGroup.STUDIO_APP_LAUNCH_TOTAL, getPlatformMetric() );
		// Bump stat for unique weekly app launch, approximates weekly active users
		bumpAggregatedUniqueStat(
			StatsGroup.STUDIO_APP_LAUNCH_UNIQUE,
			getPlatformMetric(),
			'weekly'
		).catch( ( err ) => Sentry.captureException( err ) );
		// Bump stat for unique monthly app launch, approximates monthly active users
		bumpAggregatedUniqueStat(
			StatsGroup.STUDIO_APP_LAUNCH_UNIQUE_MONTHLY,
			getPlatformMetric(),
			'monthly'
		).catch( ( err ) => Sentry.captureException( err ) );

		await updateWindowsCliVersionedPathIfNeeded();

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

	/**
	 * We want to stop all running sites (including the process daemon) in any of these cases:
	 * - There's a pending auto-update
	 * - There are no running sites (in which case we kill just the daemon)
	 * - There are running sites, and the user has confirmed they want to stop them upon closing the app
	 */
	let shouldStopSitesOnQuit = true;
	let isQuittingConfirmed = false;

	app.on( 'before-quit', ( event ) => {
		if ( isQuittingConfirmed ) {
			return;
		}

		if ( hasActiveSyncOperations() ) {
			const QUIT_APP_BUTTON_INDEX = 0;
			const CANCEL_BUTTON_INDEX = 1;

			const messageInformation: Pick< MessageBoxSyncOptions, 'message' | 'detail' | 'type' > =
				hasUploadingPushOperations()
					? {
							message: __( 'Sync is in progress' ),
							detail: __(
								"There's a sync operation in progress. Quitting the app will abort that operation. Are you sure you want to quit?"
							),
							type: 'warning',
					  }
					: {
							message: __( 'Sync will continue' ),
							detail: __(
								'The sync process will continue running remotely after you quit Studio. We will send you an email once it is complete.'
							),
							type: 'info',
					  };

			const clickedButtonIndex = dialog.showMessageBoxSync( {
				message: messageInformation.message,
				detail: messageInformation.detail,
				type: messageInformation.type,
				buttons: [ __( 'Yes, quit the app' ), __( 'No, take me back' ) ],
				cancelId: CANCEL_BUTTON_INDEX,
				defaultId: QUIT_APP_BUTTON_INDEX,
			} );

			if ( clickedButtonIndex === CANCEL_BUTTON_INDEX ) {
				event.preventDefault();
				return;
			}
		}

		const runningSiteCount = getRunningSiteCount();
		if ( getAutoUpdaterState() !== 'waiting-for-restart' && runningSiteCount > 0 ) {
			event.preventDefault();

			void ( async () => {
				const userData = await loadUserData();
				const isCliInstalled = await isStudioCliInstalled();

				if ( userData.stopSitesOnQuit !== undefined ) {
					shouldStopSitesOnQuit = userData.stopSitesOnQuit;
					isQuittingConfirmed = true;
					app.quit();
					return;
				}

				if ( ! isCliInstalled || process.env.E2E ) {
					isQuittingConfirmed = true;
					app.quit();
					return;
				}

				const STOP_SITES_BUTTON_INDEX = 0;
				const CANCEL_BUTTON_INDEX = 2;

				const { response, checkboxChecked } = await dialog.showMessageBox( {
					type: 'question',
					message: _n( 'You have a running site', 'You have running sites', runningSiteCount ),
					detail: sprintf(
						_n(
							'%d site is currently running. Do you want to stop it before quitting?',
							'%d sites are currently running. Do you want to stop them before quitting?',
							runningSiteCount
						),
						runningSiteCount
					),
					buttons: [ __( 'Stop sites' ), __( 'Leave running' ), __( 'Cancel' ) ],
					checkboxLabel: __( "Don't ask again" ),
					cancelId: CANCEL_BUTTON_INDEX,
					defaultId: STOP_SITES_BUTTON_INDEX,
				} );

				if ( response === CANCEL_BUTTON_INDEX ) {
					return;
				}

				const stopSites = response === STOP_SITES_BUTTON_INDEX;

				if ( checkboxChecked ) {
					await updateAppdata( { stopSitesOnQuit: stopSites } );
				}

				shouldStopSitesOnQuit = stopSites;
				isQuittingConfirmed = true;
				app.quit();
			} )();

			return;
		}
	} );

	app.on( 'will-quit', ( event ) => {
		globalShortcut.unregisterAll();
		stopUserDataWatcher();
		stopCliEventsSubscriber();

		if ( shouldStopSitesOnQuit ) {
			event.preventDefault();
			stopAllServers( true, 6_000 )
				.then( () => {
					app.exit();
				} )
				.catch( () => {
					app.exit();
				} );
		}
	} );

	app.on( 'activate', () => {
		if ( ! finishedInitialization ) {
			return;
		}

		if ( BrowserWindow.getAllWindows().length === 0 ) {
			// On OS X it's common to re-create a window in the app when the
			// dock icon is clicked and there are no other windows open.
			void createMainWindow();
		}
	} );
}
