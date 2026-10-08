import { app, dialog } from 'electron';
import { __ } from '@wordpress/i18n';
import { shellOpenExternalWrapper } from 'src/lib/shell-open-external-wrapper';
import { getMainWindow } from 'src/main-window';
import { loadUserData, updateAppdata } from 'src/storage/user-data';

// An x64 build running under Rosetta or Windows on ARM emulation: sites and the agent run much
// slower than in the native build, and updates keep the same architecture.
export async function warnIfRunningUnderArm64Translation() {
	if ( ! app.runningUnderARM64Translation || process.env.E2E ) {
		return;
	}
	if ( ( await loadUserData() ).dontShowArm64Warning ) {
		return;
	}

	const mainWindow = await getMainWindow();
	const { response, checkboxChecked } = await dialog.showMessageBox( mainWindow, {
		type: 'warning',
		message: __( 'This version of Studio is not optimized for your computer' ),
		detail:
			process.platform === 'darwin'
				? __(
						'Downloading the Apple Silicon Chip version of Studio will provide better performance.'
				  )
				: __( 'Downloading the ARM version of Studio will provide better performance.' ),
		checkboxLabel: __( "Don't show this warning again" ),
		buttons: [ __( 'Download' ), __( 'Not now' ) ],
		cancelId: 1,
	} );

	if ( checkboxChecked ) {
		await updateAppdata( { dontShowArm64Warning: true } );
	}
	if ( response === 0 ) {
		void shellOpenExternalWrapper( 'https://developer.wordpress.com/studio/' );
	}
}
