import { app, autoUpdater, dialog } from 'electron';
import * as Sentry from '@sentry/electron/main';
import { __ } from '@wordpress/i18n';
import { AUTO_UPDATE_INTERVAL_MS } from './constants';

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
	process.env.NODE_ENV === 'production' && app.isPackaged && ! app.getVersion().includes( '-dev.' );

export function setupUpdates() {
	if ( process.env.E2E ) {
		console.log( 'Skipping update server setup in E2E tests' );
		updaterState = 'done';
		return;
	}

	const url = new URL( 'https://public-api.wordpress.com/wpcom/v2/studio-app/updates' );
	url.searchParams.append( 'platform', process.platform );
	url.searchParams.append( 'arch', process.arch );
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

		updaterState = 'polling';
		timeout = setTimeout( () => {
			console.log( `Automatically checking for update: ${ autoUpdater.getFeedURL() }` );
			autoUpdater.checkForUpdates();
		}, AUTO_UPDATE_INTERVAL_MS );
	} );

	autoUpdater.on( 'error', ( err ) => {
		console.error( err );
		Sentry.captureException( err );

		// Doesn't re-queue an update after an error.
		updaterState = 'done';
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

async function showUpdateAvailableNotice() {
	showManualCheckDialogs = false;
	await dialog.showMessageBox( {
		type: 'info',
		buttons: [ __( 'OK' ) ],
		title: __( 'New Version Available' ),
		message: __( 'The latest version is being downloaded.' ),
	} );
}

async function showUpdateUnavailableNotice() {
	showManualCheckDialogs = false;
	await dialog.showMessageBox( {
		type: 'info',
		buttons: [ __( 'OK' ) ],
		title: __( 'Application Update' ),
		message: __( 'You are already running the latest version.' ),
	} );
}

async function showUpdateReadyToInstallNotice() {
	const { response } = await dialog.showMessageBox( {
		type: 'info',
		buttons: [ __( 'Restart' ), __( 'Later' ) ],
		title: __( 'Application Update' ),
		message: __(
			'A new version has been downloaded. Restart the application to apply the updates.'
		),
	} );

	if ( response === 0 ) {
		autoUpdater.quitAndInstall();
	}
}
