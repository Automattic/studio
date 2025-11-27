import { dialog } from 'electron';
import { __ } from '@wordpress/i18n';
import { getMainWindow } from 'src/main-window';
import {
	installCliWithConfirmation as installCliMacOS,
	isCliInstalled as isCliInstalledMacOS,
	uninstallCliWithConfirmation as uninstallCliOnMacOS,
} from 'src/modules/cli/lib/installation/macos';
import {
	installCli as installCliOnWindows,
	isCliInstalled as isCliInstalledWindows,
	uninstallCli as uninstallCliOnWindows,
} from 'src/modules/cli/lib/installation/windows';

export async function isStudioCliInstalled(): Promise< boolean > {
	switch ( process.platform ) {
		case 'darwin':
			return await isCliInstalledMacOS();
		case 'win32':
			return await isCliInstalledWindows();
		default:
			return false;
	}
}

export async function installStudioCli(): Promise< void > {
	if ( process.env.NODE_ENV !== 'production' ) {
		const mainWindow = await getMainWindow();
		const { response } = await dialog.showMessageBox( mainWindow, {
			type: 'warning',
			buttons: [ __( 'Proceed' ), __( 'Cancel' ) ],
			title: 'You are running a development version of Studio',
			message:
				'If you proceed with the CLI installation, the CLI will use the system-level `node` runtime to execute commands instead of the Electron node runtime (which is what is used in production).',
		} );

		if ( response === 1 ) {
			return;
		}
	}

	if ( process.platform === 'darwin' ) {
		await installCliMacOS();
	} else if ( process.platform === 'win32' ) {
		await installCliOnWindows();
	}
}

export async function uninstallStudioCli(): Promise< void > {
	if ( process.env.NODE_ENV !== 'production' ) {
		const mainWindow = await getMainWindow();
		const { response } = await dialog.showMessageBox( mainWindow, {
			type: 'warning',
			buttons: [ __( 'Proceed' ), __( 'Cancel' ) ],
			title: 'You are running a development version of Studio',
			message:
				'By uninstalling the CLI, you may be removing a version that uses the Electron runtime to execute commands. If you install the CLI again using a development version of Studio, a different node runtime will be used to execute commands.',
		} );

		if ( response === 1 ) {
			return;
		}
	}

	if ( process.platform === 'darwin' ) {
		await uninstallCliOnMacOS();
	} else if ( process.platform === 'win32' ) {
		await uninstallCliOnWindows();
	}
}
