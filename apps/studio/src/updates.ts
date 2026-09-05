import { app, autoUpdater, clipboard, dialog } from 'electron';
import * as Sentry from '@sentry/electron/main';
import { sprintf, __ } from '@wordpress/i18n';
import { AUTO_UPDATE_INTERVAL_MS, NIGHTLY_UPDATE_TTL_MS } from 'src/constants';
import { sendIpcEventToRenderer, type AppUpdateStatus } from 'src/ipc-utils';
import { shellOpenExternalWrapper } from 'src/lib/shell-open-external-wrapper';
import { getPreferredStudioUiMode } from 'src/lib/studio-ui-mode';
import { isDevRelease } from 'src/lib/version-utils';
import { getExistingMainWindow, getMainWindow } from 'src/main-window';
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
	} );

	autoUpdater.on( 'update-available', async () => {
		console.log( 'Update available' );
		updaterState = 'downloading';

		if ( isDevRelease( app.getVersion() ) ) {
			await updateAppdata( { lastNightlyUpdateCheck: Date.now() } );
		}

		if ( showManualCheckDialogs ) {
			await showUpdateAvailableNotice();
		}
	} );

	autoUpdater.on( 'update-not-available', async () => {
		if ( showManualCheckDialogs ) {
			await showUpdateUnavailableNotice();
		}

		if ( ! shouldPoll ) {
			updaterState = 'done';
			return;
		}

		if ( isDevRelease( app.getVersion() ) ) {
			await updateAppdata( { lastNightlyUpdateCheck: Date.now() } );
		}

		queueUpdateCheck();
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

		console.error( err );
		Sentry.captureException( err );
	} );

	autoUpdater.on( 'update-available', () => {
		console.log( 'Update available' );
	} );

	autoUpdater.on( 'update-downloaded', async ( _event, releaseNotes, releaseName ) => {
		updaterState = 'waiting-for-restart';
		downloadedVersion = typeof releaseName === 'string' ? releaseName : null;
		console.log( 'Update has been downloaded', { version: downloadedVersion } );
		void sendIpcEventToRenderer( 'app-update-status', buildAppUpdateStatus() );
		// The agentic UI surfaces this as a dismissable card in the sidebar, so a modal on top of
		// it would be a duplicate interruption. Classic has no such affordance and still needs it.
		if ( getPreferredStudioUiMode() !== 'agentic' ) {
			await showUpdateReadyToInstallNotice();
		}
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
		// Not a valid state to check for updatees, user should be manually restarting instead
		// However, let's open the dialog to let them easily restart
		console.log( 'Update has been already downloaded, proposing to restart again' );
		await showUpdateReadyToInstallNotice();
		return;
	}

	if ( updaterState === 'downloading' ) {
		console.log( 'Manually checking for update, but discovered a download is already in progress' );
		await showUpdateAvailableNotice();
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

async function showUpdateAvailableNotice() {
	showManualCheckDialogs = false;
	const mainWindow = await getMainWindow();
	await dialog.showMessageBox( mainWindow, {
		type: 'info',
		buttons: [ __( 'OK' ) ],
		title: __( 'New Version Available' ),
		message: __( 'Downloading update in the background' ),
		detail: __(
			'Studio will notify you when the update is ready to install. You can continue working normally.'
		),
	} );
}

async function showUpdateUnavailableNotice() {
	showManualCheckDialogs = false;
	const mainWindow = await getMainWindow();
	await dialog.showMessageBox( mainWindow, {
		type: 'info',
		buttons: [ __( 'OK' ) ],
		title: __( 'Application Update' ),
		message: __( 'No updates available' ),
		detail: __(
			"You're already running the latest version of Studio. No update is needed at this time."
		),
	} );
}

async function showUpdateReadyToInstallNotice() {
	// Only show the restart dialog if a window is already open. If the user
	// closed the window while an update was downloading, don't recreate it —
	// the update will be applied on the next launch or when the user reopens
	// the app from the dock.
	const existingWindow = getExistingMainWindow();
	if ( ! existingWindow ) {
		return;
	}
	const { response } = await dialog.showMessageBox( existingWindow, {
		type: 'info',
		buttons: [ __( 'Restart' ), __( 'Later' ) ],
		title: __( 'Application Update' ),
		message: __( 'Update ready to install' ),
		detail: __(
			'Restart Studio now to install the update, or choose Later to continue working and restart when convenient.'
		),
		defaultId: 0,
		cancelId: 1,
	} );

	if ( response === 0 ) {
		autoUpdater.quitAndInstall();
	}
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

	try {
		const response = await fetch( buildUpdateFeedUrl( { channel } ) );

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

	const existingWindow = getExistingMainWindow();
	if ( ! existingWindow ) {
		return;
	}
	await dialog.showMessageBox( existingWindow, {
		type: 'warning',
		buttons: [ __( 'OK' ) ],
		message: __( 'Error updating Studio' ),
		detail: `${ detailMessage }\n\n${ detailPath }`,
	} );
}

function buildAppUpdateStatus(): AppUpdateStatus {
	return {
		readyToInstall: updaterState === 'waiting-for-restart',
		version: downloadedVersion,
	};
}

export async function getAppUpdateStatus( _event: IpcMainInvokeEvent ): Promise< AppUpdateStatus > {
	return buildAppUpdateStatus();
}

export async function installAppUpdate( _event: IpcMainInvokeEvent ): Promise< void > {
	if ( updaterState === 'waiting-for-restart' ) {
		autoUpdater.quitAndInstall();
	}
}
