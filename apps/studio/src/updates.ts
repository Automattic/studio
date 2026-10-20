import { app, autoUpdater, clipboard, dialog } from 'electron';
import * as Sentry from '@sentry/electron/main';
import { sprintf, __ } from '@wordpress/i18n';
import { AUTO_UPDATE_INTERVAL_MS, NIGHTLY_UPDATE_TTL_MS } from 'src/constants';
import { sendIpcEventToRenderer, type AppUpdateStatus } from 'src/ipc-utils';
import { shellOpenExternalWrapper } from 'src/lib/shell-open-external-wrapper';
import { isDevRelease } from 'src/lib/version-utils';
import { getExistingMainWindow } from 'src/main-window';
import { loadUserData, updateAppdata } from 'src/storage/user-data';
import type { IpcMainInvokeEvent } from 'electron';

type UpdpaterState =
	| 'init'
	| 'done' // done until further notice i.e. not polling
	| 'polling' // waiting until polling interval is reached
	| 'checking-for-update' // waiting for update server response
	| 'downloading'
	| 'waiting-for-restart'; // download is complete, app will update after restart

let updaterState: UpdpaterState = 'init';
let downloadedVersion: string | null = null;
// Target version for an in-flight download. Electron's autoUpdater doesn't name it until
// `update-downloaded`, so it's fetched from the feed separately and may stay null.
let availableVersion: string | null = null;
let lastError: { reason: 'read-only-volume' | 'generic'; detail?: string } | null = null;
// Which feed the updater is pointed at, so follow-up lookups query the same channel.
let activeChannel: 'nightly' | undefined;

let timeout: NodeJS.Timeout | null = null;

let showManualCheckDialogs = false;

const shouldPoll = process.env.NODE_ENV === 'production' && app.isPackaged;

const STUDIO_UPDATES_ENDPOINT = 'https://public-api.wordpress.com/wpcom/v2/studio-app/updates';

function buildUpdateFeedUrl( { channel }: { channel?: 'nightly' } = {} ): string {
	const url = new URL( STUDIO_UPDATES_ENDPOINT );
	url.searchParams.append( 'platform', process.platform );
	url.searchParams.append( 'studioArch', process.arch );
	url.searchParams.append( 'version', app.getVersion() );
	if ( channel ) {
		url.searchParams.append( 'channel', channel );
	}
	return url.toString();
}

export function getAutoUpdaterState() {
	return updaterState;
}

/**
 * Switches the autoUpdater feed to the nightly channel and immediately checks for an update.
 * On Linux, triggers a nightly poll directly since Electron's autoUpdater is not available.
 */
export function switchToNightlyAndUpdate(): void {
	if ( process.platform === 'linux' ) {
		console.log( 'Switching to nightly channel and polling for update (Linux)' );
		void pollLinuxUpdates( { channel: 'nightly' } );
		return;
	}
	const feedUrl = buildUpdateFeedUrl( { channel: 'nightly' } );
	console.log( `Switching to nightly channel and checking for update: ${ feedUrl }` );
	activeChannel = 'nightly';
	autoUpdater.setFeedURL( { url: feedUrl } );
	autoUpdater.checkForUpdates();
}

export function setupUpdates() {
	if ( process.env.E2E ) {
		console.log( 'Skipping update server setup in E2E tests' );
		updaterState = 'done';
		return;
	}

	if ( process.platform === 'linux' ) {
		// Electron's built-in autoUpdater is macOS/Windows only. On Linux we
		// poll the same WPCOM endpoint ourselves and show a dialog pointing
		// the user at the .deb to install manually.
		setupLinuxUpdates();
		return;
	}

	autoUpdater.setFeedURL( { url: buildUpdateFeedUrl() } );

	autoUpdater.on( 'checking-for-update', () => {
		updaterState = 'checking-for-update';
		lastError = null;
		emitAppUpdateStatus();
	} );

	autoUpdater.on( 'update-available', async () => {
		console.log( 'Update available' );
		updaterState = 'downloading';
		lastError = null;
		availableVersion = null;
		emitAppUpdateStatus();

		if ( isDevRelease( app.getVersion() ) ) {
			await updateAppdata( { lastNightlyUpdateCheck: Date.now() } );
		}

		// Before the notice, so the dialog can name the version it's downloading.
		availableVersion = await fetchAvailableVersion( { channel: activeChannel } );
		if ( availableVersion ) {
			emitAppUpdateStatus();
		}

		// The renderer reports this in the sidebar.
		showManualCheckDialogs = false;
	} );

	autoUpdater.on( 'update-not-available', async () => {
		if ( showManualCheckDialogs ) {
			await showUpdateUnavailableNotice();
		}

		availableVersion = null;
		lastError = null;

		if ( ! shouldPoll ) {
			updaterState = 'done';
			emitAppUpdateStatus();
			return;
		}

		if ( isDevRelease( app.getVersion() ) ) {
			await updateAppdata( { lastNightlyUpdateCheck: Date.now() } );
		}

		queueUpdateCheck();
		emitAppUpdateStatus();
	} );

	autoUpdater.on( 'error', ( err ) => {
		if ( 'code' in err && ( err.code === -1009 || err.code === -1005 ) ) {
			// Corresponds to errors: "The Internet connection appears to be offline." and "The network connection was lost."
			// We don't need to stop polling, the internet might come back.
			queueUpdateCheck();
			return;
		}

		// Doesn't re-queue an update after an error.
		updaterState = 'done';

		const isReadOnlyVolumeError = 'code' in err && err.code === 8;
		if ( isReadOnlyVolumeError && process.platform === 'darwin' ) {
			void showReadOnlyVolumeError( err );
			return;
		}

		lastError = { reason: 'generic' };
		emitAppUpdateStatus();

		console.error( err );
		Sentry.captureException( err );
	} );

	autoUpdater.on( 'update-downloaded', async ( _event, releaseNotes, releaseName ) => {
		updaterState = 'waiting-for-restart';
		lastError = null;
		downloadedVersion = typeof releaseName === 'string' ? releaseName : null;
		console.log( 'Update has been downloaded', { version: downloadedVersion } );
		emitAppUpdateStatus();
	} );

	if ( ! shouldPoll ) {
		console.log( 'Skipping auto-updates', {
			env: process.env.NODE_ENV,
			isPackaged: app.isPackaged,
			version: app.getVersion(),
		} );
		return;
	}

	if ( isDevRelease( app.getVersion() ) ) {
		// For nightly builds, respect a 24-hour TTL to avoid checking on every launch.
		// If the TTL hasn't elapsed, schedule the next check for the remaining time.
		void ( async () => {
			const userData = await loadUserData();
			const lastCheck = userData.lastNightlyUpdateCheck ?? 0;
			const elapsed = Date.now() - lastCheck;
			if ( elapsed < NIGHTLY_UPDATE_TTL_MS ) {
				const remaining = NIGHTLY_UPDATE_TTL_MS - elapsed;
				console.log(
					`Nightly update check skipped, next check in ${ Math.round( remaining / 60000 ) } minutes`
				);
				updaterState = 'polling';
				timeout = setTimeout( () => {
					console.log( `Automatically checking for nightly update: ${ autoUpdater.getFeedURL() }` );
					autoUpdater.checkForUpdates();
				}, remaining );
				return;
			}
			console.log( `Checking for nightly update on app launch: ${ autoUpdater.getFeedURL() }` );
			autoUpdater.checkForUpdates();
		} )();
		return;
	}

	console.log( `Checking for update on app launch: ${ autoUpdater.getFeedURL() }` );
	autoUpdater.checkForUpdates();
}

export async function manualCheckForUpdates() {
	if ( updaterState === 'waiting-for-restart' ) {
		// Not a valid state to check for updates: the user should restart instead. Re-emitting
		// re-surfaces the sidebar card if they dismissed it, so the menu item still does something.
		console.log( 'Update has been already downloaded, proposing to restart again' );
		emitAppUpdateStatus( { requested: true } );
		return;
	}

	if ( updaterState === 'downloading' ) {
		console.log( 'Manually checking for update, but discovered a download is already in progress' );
		emitAppUpdateStatus( { requested: true } );
		return;
	}

	if ( updaterState === 'polling' && timeout ) {
		// We're manually checking ahead of the scheduled time
		clearTimeout( timeout );
	}

	// An automatic check or download may already be in progress when the user requests an
	// update, so we re-use the same event handlers for manual checks. This boolean signals
	// to the event handler that it should show a dialog.
	showManualCheckDialogs = true;

	if ( process.platform === 'linux' ) {
		if ( updaterState === 'checking-for-update' ) {
			console.log( 'Manually polling for Linux update, but a check is already in progress' );
			return;
		}
		console.log( 'Manually polling for Linux update' );
		void pollLinuxUpdates();
		return;
	}

	if ( updaterState === 'checking-for-update' ) {
		console.log( 'Manually checking for update, but discovered an check is already in progress' );
	} else {
		console.log( `Manually checking for update: ${ autoUpdater.getFeedURL() }` );
		autoUpdater.checkForUpdates();
	}
}

export function isUpdateReadyToInstall() {
	return updaterState === 'waiting-for-restart';
}

function queueUpdateCheck() {
	updaterState = 'polling';
	timeout = setTimeout( () => {
		console.log( `Automatically checking for update: ${ autoUpdater.getFeedURL() }` );
		autoUpdater.checkForUpdates();
	}, AUTO_UPDATE_INTERVAL_MS );
}

async function showUpdateUnavailableNotice() {
	showManualCheckDialogs = false;
	// The renderer answers with a toast: there's nothing to act on.
	void sendIpcEventToRenderer( 'app-update-not-available', { currentVersion: app.getVersion() } );
}

function setupLinuxUpdates() {
	if ( ! shouldPoll ) {
		console.log( 'Skipping Linux update checks', {
			env: process.env.NODE_ENV,
			isPackaged: app.isPackaged,
			version: app.getVersion(),
		} );
		return;
	}

	console.log( 'Polling for Linux update on app launch' );
	void pollLinuxUpdates();
}

async function pollLinuxUpdates( { channel }: { channel?: 'nightly' } = {} ) {
	updaterState = 'checking-for-update';
	// Later polls stay on the channel the user switched to.
	activeChannel = channel ?? activeChannel;

	try {
		const response = await fetch( buildUpdateFeedUrl( { channel: activeChannel } ) );

		if ( response.status === 204 ) {
			if ( showManualCheckDialogs ) {
				await showUpdateUnavailableNotice();
			}
			return;
		}

		if ( response.status === 404 ) {
			Sentry.captureException(
				new Error( `Linux updates endpoint returned 404 (arch=${ process.arch })` )
			);
			return;
		}

		if ( ! response.ok ) {
			Sentry.captureException(
				new Error( `Linux updates endpoint returned HTTP ${ response.status }` )
			);
			return;
		}

		const data = ( await response.json() ) as { version?: string; downloadUrl?: string };

		if ( ! data?.version || ! data?.downloadUrl ) {
			Sentry.captureException( new Error( 'Linux updates endpoint returned malformed response' ) );
			return;
		}

		await showLinuxUpdateAvailableNotice( data.version, data.downloadUrl );
	} catch ( err ) {
		console.error( err );
		Sentry.captureException( err );
	} finally {
		showManualCheckDialogs = false;
		rescheduleLinuxOrFinish();
	}
}

function rescheduleLinuxOrFinish() {
	if ( ! shouldPoll ) {
		updaterState = 'done';
		return;
	}
	updaterState = 'polling';
	timeout = setTimeout( () => {
		console.log( 'Automatically polling for Linux update' );
		void pollLinuxUpdates();
	}, AUTO_UPDATE_INTERVAL_MS );
}

async function showLinuxUpdateAvailableNotice( version: string, downloadUrl: string ) {
	const mainWindow = getExistingMainWindow();
	if ( ! mainWindow ) {
		return;
	}

	const command = `sudo apt install ~/Downloads/${ debFilenameFromUrl( downloadUrl ) }`;
	const actionDescription = __(
		'Clicking the button below will download the new package and copy the install command to your clipboard.'
	);
	const followUpInstruction = __(
		'Once the download finishes, quit Studio, open a terminal, and paste the command to install:'
	);

	const { response } = await dialog.showMessageBox( mainWindow, {
		type: 'info',
		buttons: [ __( 'Download & copy command' ), __( 'Later' ) ],
		title: __( 'New Version Available' ),
		// translators: %s is the version number, e.g. "1.9.0".
		message: sprintf( __( 'Studio %s is available' ), version ),
		detail: `${ actionDescription }\n\n${ followUpInstruction }\n\n${ command }`,
		defaultId: 0,
		cancelId: 1,
	} );

	if ( response !== 0 ) {
		return;
	}

	try {
		const parsedUrl = new URL( downloadUrl );
		if ( ! [ 'http:', 'https:' ].includes( parsedUrl.protocol ) ) {
			Sentry.captureException(
				new Error( `Unexpected protocol in downloadUrl: ${ parsedUrl.protocol }` )
			);
			return;
		}
		await clipboard.writeText( command );
		void shellOpenExternalWrapper( parsedUrl.toString() );
	} catch {
		Sentry.captureException( new Error( `Malformed downloadUrl: ${ downloadUrl }` ) );
	}
}

function debFilenameFromUrl( downloadUrl: string ): string {
	try {
		const filename = new URL( downloadUrl ).pathname.split( '/' ).pop() ?? '';
		if ( /^[A-Za-z0-9._~+-]+\.deb$/.test( filename ) ) {
			return filename;
		}
	} catch {
		// ignore
	}
	return 'studio.deb';
}

function isAppRunningFromDMG(): boolean {
	if ( process.platform !== 'darwin' ) {
		return false;
	}

	const appPath = app.getPath( 'exe' );
	return appPath.startsWith( '/Volumes/' ) || appPath.startsWith( '/private/var/folders' );
}

async function showReadOnlyVolumeError( err: Error ) {
	let detailMessage = '';
	let detailPath = '';
	if ( isAppRunningFromDMG() ) {
		detailMessage = __(
			'Studio can only update automatically from the Applications folder. Please move Studio to Applications and try again.'
		);
		detailPath = sprintf(
			__( 'Studio is running from a disk image at: %s' ),
			app.getPath( 'exe' )
		);
	} else if ( ! app.isInApplicationsFolder() ) {
		detailMessage = __(
			'Studio can only update automatically from the Applications folder. Please move Studio to Applications and try again.'
		);
		detailPath = sprintf( __( 'Studio is running from: %s' ), app.getPath( 'exe' ) );
	} else {
		detailMessage = __(
			'Studio can only update from the writable Applications folder. Please check write permissions and try again.'
		);
		detailPath = sprintf( __( 'Studio is running from: %s' ), app.getPath( 'exe' ) );

		console.error( err );
	}

	lastError = { reason: 'read-only-volume', detail: `${ detailMessage }\n\n${ detailPath }` };

	emitAppUpdateStatus();
}

function buildAppUpdateStatus(): AppUpdateStatus {
	const currentVersion = app.getVersion();

	if ( lastError ) {
		return { state: 'error', currentVersion, ...lastError };
	}

	switch ( updaterState ) {
		case 'checking-for-update':
			return { state: 'checking', currentVersion };
		case 'downloading':
			return { state: 'downloading', currentVersion, newVersion: availableVersion };
		case 'waiting-for-restart':
			return { state: 'ready', currentVersion, newVersion: downloadedVersion ?? availableVersion };
		default:
			return { state: 'idle', currentVersion };
	}
}

function emitAppUpdateStatus( { requested }: { requested?: boolean } = {} ): void {
	const status = buildAppUpdateStatus();
	void sendIpcEventToRenderer(
		'app-update-status',
		requested ? { ...status, requested: true } : status
	);
}

/**
 * Looks up the version the feed is offering. Electron's autoUpdater withholds it until the
 * download finishes, so the renderer would otherwise have nothing to show while downloading.
 * Best-effort: any failure just leaves the version unnamed.
 */
async function fetchAvailableVersion( { channel }: { channel?: 'nightly' } = {} ): Promise<
	string | null
> {
	try {
		const response = await fetch( buildUpdateFeedUrl( { channel } ) );
		if ( ! response.ok ) {
			return null;
		}
		// Shapes differ by platform: Linux gets `{ version, downloadUrl }`, while macOS and
		// Windows get Squirrel's `{ url }`, whose path carries the version as a `v1.2.3` segment.
		const data = ( await response.json() ) as { version?: string; url?: string };
		return data?.version ?? versionFromUpdateUrl( data?.url ) ?? null;
	} catch {
		return null;
	}
}

function versionFromUpdateUrl( url: string | undefined ): string | null {
	if ( ! url ) {
		return null;
	}
	return /\/v(\d+\.\d+\.\d+[^/]*)\//.exec( url )?.[ 1 ] ?? null;
}

export async function getAppUpdateStatus( _event: IpcMainInvokeEvent ): Promise< AppUpdateStatus > {
	return buildAppUpdateStatus();
}

export async function installAppUpdate( _event: IpcMainInvokeEvent ): Promise< void > {
	if ( updaterState === 'waiting-for-restart' ) {
		autoUpdater.quitAndInstall();
	}
}
