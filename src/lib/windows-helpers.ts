import { app, dialog, shell } from 'electron';
import { __ } from '@wordpress/i18n';
import sudo from 'sudo-prompt';
import { STUDIO_DOCS_WINDOWS_SPEED_UP_SITES_URL } from '../constants';
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

	const NOT_INTERESTED = __( "I'm not interested." );
	const MANUAL_UPDATE = __( "I'll do it my own by following the documentation." );
	const AUTOMATIC_UPDATE = __( 'Sounds good, do it for me.' );

	const buttons = [ NOT_INTERESTED, MANUAL_UPDATE, AUTOMATIC_UPDATE ];

	const { response } = await dialog.showMessageBox( {
		type: 'question',
		buttons,
		title: __( 'Want to speed up sites?' ),
		message: __(
			"If the Real-Time Protection Service of Windows Defender is enabled on your machine, it may slow down the process of creating and starting a site.\n\nTo enhance site speed, it's recommended adjusting the configuration accordingly.\n\nThe app can do this automatically for you, or alternatively, you can follow the documentation."
		),
	} );

	switch ( response ) {
		case buttons.indexOf( AUTOMATIC_UPDATE ):
			//
			await saveUserData( {
				...userData,
				promptWindowsSpeedUpResult: 'yes',
			} );
			await excludeProcessInWindowsDefender();
			break;
		case buttons.indexOf( MANUAL_UPDATE ):
			// Will be done manually by the user
			await saveUserData( {
				...userData,
				promptWindowsSpeedUpResult: 'manual',
			} );
			await shell.openExternal( STUDIO_DOCS_WINDOWS_SPEED_UP_SITES_URL );
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
	const command = `PowerShell -NoProfile -ExecutionPolicy Bypass -Command "Add-MpPreference -ExclusionProcess ${ app.getPath(
		'exe'
	) }"`;
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
