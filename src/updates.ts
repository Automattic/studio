import { app, autoUpdater, dialog } from 'electron';
import * as Sentry from '@sentry/electron/main';
import { sprintf, __ } from '@wordpress/i18n';
import { AUTO_UPDATE_INTERVAL_MS } from 'src/constants';
import { isDevRelease } from 'src/lib/version-utils';
import { getMainWindow } from 'src/main-window';

type UpdpaterState =
	| 'init'
	| 'done' // done until further notice i.e. not polling
	| 'polling' // waiting until polling interval is reached
	| 'checking-for-update' // waiting for update server response
	| 'downloading'
	| 'waiting-for-restart'; // download is complete, app will update after restart

let updaterState: UpdpaterState = 'init';

let timeout: NodeJS.Timeout | null = null;

let showManualCheckDialogs = false;

const shouldPoll =
	process.env.NODE_ENV === 'production' && app.isPackaged && ! isDevRelease( app.getVersion() );

export function setupUpdates() {
	if ( process.env.E2E ) {
		console.log( 'Skipping update server setup in E2E tests' );
		updaterState = 'done';
		return;
	}

	const url = new URL( 'https://public-api.wordpress.com/wpcom/v2/studio-app/updates' );
	url.searchParams.append( 'platform', process.platform );
	url.searchParams.append( 'localStudioArch', process.arch );
	url.searchParams.append( 'version', app.getVersion() );

	autoUpdater.setFeedURL( { url: url.toString() } );

	autoUpdater.on( 'checking-for-update', () => {
		updaterState = 'checking-for-update';
	} );

	autoUpdater.on( 'update-available', async () => {
		console.log( 'Update available' );
		updaterState = 'downloading';

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

	autoUpdater.on( 'update-downloaded', async () => {
		updaterState = 'waiting-for-restart';
		console.log( 'Update has been downloaded' );
		await showUpdateReadyToInstallNotice();
	} );

	if ( ! shouldPoll ) {
		console.log( 'Skipping auto-updates', {
			env: process.env.NODE_ENV,
			isPackaged: app.isPackaged,
			version: app.getVersion(),
		} );
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
	const mainWindow = await getMainWindow();
	const { response } = await dialog.showMessageBox( mainWindow, {
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

		// this case is not expected, so we want to capture it
		Sentry.captureException( err );
		console.error( err );
	}

	const mainWindow = await getMainWindow();
	await dialog.showMessageBox( mainWindow, {
		type: 'warning',
		buttons: [ __( 'OK' ) ],
		message: __( 'Error updating Studio' ),
		detail: `${ detailMessage }\n\n${ detailPath }`,
	} );
}
