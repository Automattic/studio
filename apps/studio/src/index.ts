// MUST be the first import: redirects config paths into the new-user
// simulation sandbox before any other module reads them.

import 'src/lib/simulation-mode';
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
	shell,
} from 'electron';
import path from 'path';
import * as Sentry from '@sentry/electron/main';
import { PROTOCOL_PREFIX } from '@studio/common/constants';
import { runMigrations } from '@studio/common/lib/migration';
import { getCurrentUserId } from '@studio/common/lib/shared-config';
import { suppressPunycodeWarning } from '@studio/common/lib/suppress-punycode-warning';
import { __, _n } from '@wordpress/i18n';
import {
	installExtension,
	REACT_DEVELOPER_TOOLS,
	REDUX_DEVTOOLS,
} from 'electron-devtools-installer';
import { IPC_VOID_HANDLERS } from 'src/constants';
import * as ipcHandlers from 'src/ipc-handlers';
import { markAppQuitting } from 'src/ipc-utils';
import {
	hasActiveSyncOperations,
	hasUploadingPushOperations,
} from 'src/lib/active-sync-operations';
import { getBetaFeatures } from 'src/lib/beta-features';
import {
	bumpStat,
	bumpAggregatedUniqueStat,
	getPlatformMetric,
	StatsGroup,
} from 'src/lib/bump-stats';
import { handleDeeplink } from 'src/lib/deeplink';
import { getUserLocaleWithFallback } from 'src/lib/locale-node';
import { setSentryWpcomUserIdMain } from 'src/lib/main-sentry-utils';
import { maybePromptNightlySwitch, startNightlyPromptPoller } from 'src/lib/nightly-prompt';
import { getSentryReleaseInfo } from 'src/lib/sentry-release';
import { getPreferredStudioUiMode, setAgenticUiEnabled } from 'src/lib/studio-ui-mode';
import { recordTracksEvent, TRACKS_EVENTS } from 'src/lib/tracks';
import { setupLogging } from 'src/logging';
import { createMainWindow, getCurrentRendererUrl, getMainWindow } from 'src/main-window';
import { migrations } from 'src/migrations';
import {
	startCliEventsSubscriber,
	stopCliEventsSubscriber,
} from 'src/modules/cli/lib/cli-events-subscriber';
import { autoInstallLinuxCliIfNeeded } from 'src/modules/cli/lib/linux-installation-manager';
import { autoInstallMacOSCliIfNeeded } from 'src/modules/cli/lib/macos-installation-manager';
import { autoInstallWindowsCliIfNeeded } from 'src/modules/cli/lib/windows-installation-manager';
import { startRemoteSessionStatusPolling } from 'src/modules/remote-session/daemon-status-poller';
import {
	getRunningSiteCount,
	persistAutoStartForRunningSites,
	SiteServer,
	stopAllServers,
} from 'src/site-server';
import {
	loadUserData,
	lockAppdata,
	saveUserData,
	unlockAppdata,
	updateAppdata,
	type QuitSitesBehavior,
} from 'src/storage/user-data';
import { getAutoUpdaterState, setupUpdates } from 'src/updates';
// eslint-disable-next-line import-x/order
import packageJson from '../package.json';

const STOP_ALL_SERVERS_ON_QUIT_TIMEOUT_MS = process.env.E2E ? 20_000 : 6_000;

// Helper function to get the actual URL for validation
function getRendererUrl(): string {
	return getCurrentRendererUrl();
}

function openExternalWebUrl( url: string ): void {
	try {
		const parsedUrl = new URL( url );
		if ( ! [ 'http:', 'https:' ].includes( parsedUrl.protocol ) ) {
			return;
		}
		void shell.openExternal( parsedUrl.toString() ).catch( () => undefined );
	} catch {
		// Ignore malformed URLs from untrusted pages.
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
let stopRemoteSessionStatusPolling: ( () => void ) | undefined;

const YOUTUBE_EMBED_REFERRER = 'https://developer.wordpress.com/studio/';
const YOUTUBE_EMBED_URL_PATTERNS = [
	'https://*.youtube.com/embed/*',
	'https://youtube.com/embed/*',
	'https://*.youtube-nocookie.com/embed/*',
	'https://youtube-nocookie.com/embed/*',
];

function getYouTubeEmbedRequestHeaders( requestHeaders: Record< string, string > ) {
	const headers = { ...requestHeaders };
	for ( const key of Object.keys( headers ) ) {
		if ( key.toLowerCase() === 'referer' ) {
			delete headers[ key ];
		}
	}
	headers.Referer = YOUTUBE_EMBED_REFERRER;
	return headers;
}

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

	const wpcomUserId = await getCurrentUserId();
	setSentryWpcomUserIdMain( wpcomUserId ?? undefined );
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

	if ( process.platform === 'win32' ) {
		// Windows toast notifications require an AppUserModelID that matches the
		// Start-menu shortcut. Squirrel stamps `com.squirrel.<nuget-id>.<exe>` on
		// installed builds; setting it here also makes toasts work in dev builds.
		app.setAppUserModelId( 'com.squirrel.studio_app.Studio' );
	}

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

	// Prevent navigation to anywhere other than known locations.
	// The site-preview `<webview>` is a separate webContents that intentionally
	// loads local WordPress pages — it's identified by `getType() === 'webview'`
	// and exempted from the renderer-origin restriction below.
	app.on( 'web-contents-created', ( _event, contents ) => {
		const isSitePreviewWebview = contents.getType() === 'webview';

		contents.on( 'will-navigate', ( event, navigationUrl ) => {
			if ( isSitePreviewWebview ) {
				return;
			}
			const { origin } = new URL( navigationUrl );
			const allowedOrigins = [ new URL( getRendererUrl() ).origin ];
			if ( ! allowedOrigins.includes( origin ) ) {
				event.preventDefault();
			}
		} );
		contents.setWindowOpenHandler( ( details ) => {
			// Site-preview popups (target="_blank", admin-bar links, …) open
			// in the user's browser rather than spawning a new Electron window.
			if ( isSitePreviewWebview ) {
				openExternalWebUrl( details.url );
			}
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
			try {
				await installExtension( REACT_DEVELOPER_TOOLS );
				await installExtension( REDUX_DEVTOOLS );
				await launchExtensionBackgroundWorkers();
			} catch ( error ) {
				// Devtools extensions are a dev nicety — never block boot on them.
				// Their install/worker start is flaky on a fresh userData directory
				// (e.g. the new-user simulation sandbox).
				console.error( 'Failed to set up devtools extensions:', error );
			}
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

		session.defaultSession.webRequest.onBeforeSendHeaders(
			{ urls: YOUTUBE_EMBED_URL_PATTERNS },
			( details, callback ) => {
				callback( {
					requestHeaders: getYouTubeEmbedRequestHeaders( details.requestHeaders ),
				} );
			}
		);

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
				"img-src 'self' https://*.gravatar.com https://*.wp.com https://blueprintlibrary.wordpress.com https://blueprintslibraryv2.wpcomstaging.com data:",
				"style-src 'self' 'unsafe-inline'", // unsafe-inline used by tailwindcss in development, and also in production after the app rename
				process.env.NODE_ENV === 'development'
					? "script-src 'self' 'unsafe-eval' 'unsafe-inline' 'wasm-unsafe-eval' data: http://localhost:*"
					: "script-src 'self' 'wasm-unsafe-eval'", // allow WebAssembly to compile and instantiate
				// Site preview uses `<webview>` to host local WordPress sites
				// served from arbitrary localhost ports and (optionally) HTTPS
				// custom domains.
				'frame-src http: https:',
			];
			const prodPolicies = [
				"connect-src 'self' https://public-api.wordpress.com https://api.wordpress.org",
			];
			const devPolicies = [
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

		await runMigrations( migrations ).catch( Sentry.captureException );

		await setupSentryUserId();
		const betaFeatures = await getBetaFeatures();
		setAgenticUiEnabled( betaFeatures.enableAgenticUi );

		// Fetch data from CLI and subscribe to CLI events before starting the user data
		// watcher. The watcher can trigger getMainWindow() which creates the window early,
		// so sites must be loaded first.
		await SiteServer.fetchAll();
		await startCliEventsSubscriber();

		await createMainWindow();

		void maybePromptNightlySwitch().catch( Sentry.captureException );
		startNightlyPromptPoller();

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

		// Tracks: structured launch event, runs in parallel with the MC Stats bumps above.
		// `is_first_launch` intentionally reuses `lastBumpStats` — it's a durable pre-existing marker,
		// so existing users read false and fresh installs read true. If the MC Stats launch bumps are
		// ever removed, migrate this to another durable per-install marker (e.g. `sentryUserId`) or a
		// dedicated flag, or it will silently report true on every launch. See the analytics design doc.
		void recordTracksEvent( TRACKS_EVENTS.APP_LAUNCH, {
			channel: 'studio-ui',
			ui_version: getPreferredStudioUiMode() === 'agentic' ? 'v2' : 'v1',
			is_first_launch: ! userData.lastBumpStats,
		} ).catch( ( err ) => Sentry.captureException( err ) );

		await autoInstallWindowsCliIfNeeded();
		await autoInstallMacOSCliIfNeeded();
		await autoInstallLinuxCliIfNeeded();

		stopRemoteSessionStatusPolling = startRemoteSessionStatusPolling();

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
	let clearAutoStartOnQuit = false;
	let isQuittingConfirmed = false;

	const applyQuitSitesBehavior = ( behavior: QuitSitesBehavior ) => {
		shouldStopSitesOnQuit = behavior !== 'leave-running';
		clearAutoStartOnQuit = behavior === 'stop';
	};

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

				if ( userData.quitSitesBehavior !== undefined ) {
					applyQuitSitesBehavior( userData.quitSitesBehavior );
					isQuittingConfirmed = true;
					app.quit();
					return;
				}

				if ( process.env.E2E ) {
					isQuittingConfirmed = true;
					app.quit();
					return;
				}

				const STOP_SITES_BUTTON_INDEX = 0;
				const KEEP_RUNNING_BUTTON_INDEX = 1;
				const CANCEL_BUTTON_INDEX = 2;

				const { response, checkboxChecked } = await dialog.showMessageBox( {
					type: 'question',
					message: _n( 'Keep the site running?', 'Keep the sites running?', runningSiteCount ),
					detail: _n(
						'Your site can stay available in the background after Studio quits.',
						'Your sites can stay available in the background after Studio quits.',
						runningSiteCount
					),
					buttons: [
						_n( 'Stop site', 'Stop sites', runningSiteCount ),
						_n( 'Keep site running', 'Keep sites running', runningSiteCount ),
						__( 'Cancel' ),
					],
					checkboxLabel: __( 'Remember my choice' ),
					cancelId: CANCEL_BUTTON_INDEX,
					defaultId: STOP_SITES_BUTTON_INDEX,
				} );

				if ( response === CANCEL_BUTTON_INDEX ) {
					return;
				}

				const behavior: QuitSitesBehavior =
					response === KEEP_RUNNING_BUTTON_INDEX ? 'leave-running' : 'stop';

				if ( checkboxChecked ) {
					await updateAppdata( { quitSitesBehavior: behavior } );
				}

				applyQuitSitesBehavior( behavior );
				isQuittingConfirmed = true;
				app.quit();
			} )();

			return;
		}
	} );

	app.on( 'will-quit', ( event ) => {
		markAppQuitting();
		globalShortcut.unregisterAll();
		stopCliEventsSubscriber();
		stopRemoteSessionStatusPolling?.();

		if ( shouldStopSitesOnQuit ) {
			event.preventDefault();
			void ( async () => {
				try {
					// The events subscriber is already stopped, so the "Stop" choice clears autoStart here.
					if ( clearAutoStartOnQuit ) {
						await persistAutoStartForRunningSites( false );
					}
					await stopAllServers( STOP_ALL_SERVERS_ON_QUIT_TIMEOUT_MS );
				} finally {
					app.exit();
				}
			} )();
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
