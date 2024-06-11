import { app, dialog, shell } from 'electron';
import path from 'path';
import { __ } from '@wordpress/i18n';
import sudo from 'sudo-prompt';
import { loadUserData, saveUserData } from '../storage/user-data';

export async function promptWindowsSpeedUpSites( {
	skipIfAlreadyPrompted,
}: {
	skipIfAlreadyPrompted: boolean;
} ) {
	const userData = await loadUserData();

	if (
		process.platform !== 'win32' ||
		( skipIfAlreadyPrompted && typeof userData.promptWindowsSpeedUpResult !== 'undefined' )
	) {
		return;
	}

	const AUTOMATIC_UPDATE = __( 'Sounds good, do it for me.' );
	const NOT_INTERESTED = __( "I'm not interested." );

	const buttons = [ AUTOMATIC_UPDATE, NOT_INTERESTED ];

	const { response } = await dialog.showMessageBox( {
		type: 'question',
		buttons,
		title: __( 'Want to speed up sites?' ),
		message: __(
			'If the Real-Time Protection Service of Windows Defender is enabled on your machine, it may slow down the process of creating and starting a site.\n\nFor optimal performance, we recommend excluding the Studio app from this service. The app can do this automatically for you.'
		),
		cancelId: buttons.indexOf( NOT_INTERESTED ),
	} );

	switch ( response ) {
		case buttons.indexOf( AUTOMATIC_UPDATE ):
			// Update Windows Defender configuration
			await saveUserData( {
				...userData,
				promptWindowsSpeedUpResult: 'yes',
			} );
			try {
				await excludeProcessInWindowsDefender();
			} catch ( _error ) {
				await dialog.showMessageBox( {
					type: 'error',
					title: __( 'Something went wrong' ),
					message: __(
						'The configuration couldn\'t be changed to speed up sites.\n\nTo initiate this process again, please go to "Help > How can I make Studio faster?" in the application menu.'
					),
				} );
			}
			break;
		case buttons.indexOf( NOT_INTERESTED ):
			// Skip it, user is not interested
			await saveUserData( {
				...userData,
				promptWindowsSpeedUpResult: 'no',
			} );
			break;
	}
}

export async function excludeProcessInWindowsDefender() {
	let exePath = app.getPath( 'exe' );
	// When the app is packaged, the exe path points to "%appdata%\Local\studio\app-{app-version}\Studio.exe".
	// To avoid updating this configuration on each update, we use a wilcard in the path to include all versions.
	if ( app.isPackaged ) {
		const exeFilename = path.basename( app.getPath( 'exe' ) );
		const exeDir = path.dirname( app.getPath( 'exe' ) );
		exePath = path.join( exeDir, '..', 'app-*', exeFilename );
	}
	const command = `PowerShell -NoProfile -ExecutionPolicy Bypass -Command "Add-MpPreference -ExclusionProcess ${ exePath }"`;
	const options = {
		name: 'Studio app',
	};
	await new Promise< void >( ( resolve, reject ) =>
		sudo.exec( command, options, function ( error ) {
			if ( error ) {
				reject( error );
				return;
			}
			resolve();
		} )
	);
}
