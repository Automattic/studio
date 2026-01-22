import { app, dialog } from 'electron';
import path from 'path';
import sudo from '@vscode/sudo-prompt';
import { __ } from '@wordpress/i18n';
import { getMainWindow } from 'src/main-window';
import { loadUserData, updateAppdata } from 'src/storage/user-data';

/**
 * Gets the Studio CLI bin directory path on Windows.
 *
 * This uses the same path calculation as WindowsCliInstallationManager.
 * In production: C:\Users\<USERNAME>\AppData\Local\studio\bin
 *
 * @returns The CLI bin directory path, or undefined on non-Windows platforms.
 */
export function getWindowsCliBinPath(): string | undefined {
	if ( process.platform !== 'win32' ) {
		return undefined;
	}

	// This matches the `unversionedBinDirPath` calculation in windows-installation-manager.ts:
	// path.resolve( path.dirname( app.getPath( 'exe' ) ), '../bin' )
	return path.resolve( path.dirname( app.getPath( 'exe' ) ), '../bin' );
}

export async function promptWindowsSpeedUpSites( {
	skipIfAlreadyPrompted,
}: {
	skipIfAlreadyPrompted: boolean;
} ) {
	const userData = await loadUserData();
	const currentAppVersion = app.getVersion();
	const previousResponse = userData.promptWindowsSpeedUpResult?.response;
	const previousAppVersion = userData.promptWindowsSpeedUpResult?.appVersion;
	const dontAskAgain = userData.promptWindowsSpeedUpResult?.dontAskAgain;

	if ( process.platform !== 'win32' ) {
		return;
	}

	// Handle legacy promptWindowsSpeedUpResult format
	if ( skipIfAlreadyPrompted && typeof userData.promptWindowsSpeedUpResult === 'string' ) {
		if ( userData.promptWindowsSpeedUpResult === 'yes' ) {
			return;
		}
	}

	if (
		process.env.E2E ||
		( skipIfAlreadyPrompted &&
			( previousResponse === 'yes' ||
				dontAskAgain ||
				( previousResponse === 'no' && previousAppVersion === currentAppVersion ) ) )
	) {
		return;
	}

	const AUTOMATIC_UPDATE = __( 'Sounds good, do it for me.' );
	const NOT_INTERESTED = __( "I'm not interested." );

	const buttons = [ AUTOMATIC_UPDATE, NOT_INTERESTED ];

	const mainWindow = await getMainWindow();
	const { response, checkboxChecked } = await dialog.showMessageBox( mainWindow, {
		type: 'question',
		buttons,
		title: __( 'Want to speed up site creation?' ),
		message: __(
			"Microsoft Defender's Real-time protection may slow site creation.\n\nTo create sites quickly, we recommend disabling Real-time protection for the Studio app."
		),
		...( skipIfAlreadyPrompted && { checkboxLabel: __( "Don't ask again" ) } ),
		cancelId: buttons.indexOf( NOT_INTERESTED ),
	} );

	switch ( response ) {
		case buttons.indexOf( AUTOMATIC_UPDATE ):
			// Update Windows Defender configuration
			await updateAppdata( {
				promptWindowsSpeedUpResult: {
					response: 'yes',
					appVersion: currentAppVersion,
					dontAskAgain: checkboxChecked,
				},
			} );
			try {
				await excludeProcessInWindowsDefender();
			} catch ( _error ) {
				const mainWindow = await getMainWindow();
				await dialog.showMessageBox( mainWindow, {
					type: 'error',
					title: __( 'Something went wrong' ),
					message: __(
						'The configuration couldn\'t be changed to speed up site creation.\n\nTo initiate this process again, please go to "Help > How can I make Studio faster?" in the application menu.'
					),
				} );
			}
			break;
		case buttons.indexOf( NOT_INTERESTED ):
			// Skip it, user is not interested
			await updateAppdata( {
				promptWindowsSpeedUpResult: {
					response: 'no',
					appVersion: currentAppVersion,
					dontAskAgain: checkboxChecked,
				},
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
