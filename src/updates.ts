import { app, autoUpdater, dialog } from 'electron';
import * as Sentry from '@sentry/electron/main';
import { __ } from '@wordpress/i18n';

export function setupUpdates() {
	if ( process.env.E2E ) {
		console.log( 'Skipping update server setup in E2E tests' );
		return;
	}

	const url = new URL( 'https://public-api.wordpress.com/wpcom/v2/studio-app-updates' );
	url.searchParams.append( 'platform', process.platform );
	url.searchParams.append( 'arch', process.arch );
	url.searchParams.append( 'version', app.getVersion() );

	autoUpdater.setFeedURL( { url: url.toString() } );

	let interval: NodeJS.Timeout | null = null;

	autoUpdater.on( 'error', ( err ) => {
		console.error( err );
		Sentry.captureException( err );
	} );

	autoUpdater.on( 'update-available', () => {
		console.log( 'Update available' );

		// Stop update from being downloaded twice
		interval && clearInterval( interval );
	} );

	autoUpdater.on( 'update-downloaded', async () => {
		console.log( 'Update has been downloaded' );

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
	} );

	if ( process.env.NODE_ENV !== 'production' || ! app.isPackaged ) {
		console.log( 'Skipping auto-updates', {
			env: process.env.NODE_ENV,
			isPackaged: app.isPackaged,
		} );
		return;
	}

	interval = setInterval( () => {
		console.log( `Automatically checking for update: ${ autoUpdater.getFeedURL() }` );
		autoUpdater.checkForUpdates();
	}, 60000 );

	console.log( `Checking for update on app launch: ${ autoUpdater.getFeedURL() }` );
	autoUpdater.checkForUpdates();
}

export function manualCheckForUpdates() {
	async function updateAvailable() {
		autoUpdater.off( 'update-not-available', updateNotAvailable );

		await dialog.showMessageBox( {
			type: 'info',
			buttons: [ __( 'OK' ) ],
			title: __( 'New Version Available' ),
			message: __( 'The latest version is being downloaded.' ),
		} );
	}

	async function updateNotAvailable() {
		autoUpdater.off( 'update-available', updateAvailable );

		await dialog.showMessageBox( {
			type: 'info',
			buttons: [ __( 'OK' ) ],
			title: __( 'Application Update' ),
			message: __( 'You are already running the latest version.' ),
		} );
	}

	autoUpdater.once( 'update-available', updateAvailable );
	autoUpdater.once( 'update-not-available', updateNotAvailable );

	console.log( `Manually checking for update: ${ autoUpdater.getFeedURL() }` );
	autoUpdater.checkForUpdates();
}
