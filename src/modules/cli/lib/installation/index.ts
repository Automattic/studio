import { dialog } from 'electron';
import { __ } from '@wordpress/i18n';
import { getMainWindow } from 'src/main-window';
import { MacOSCliInstallationManager } from 'src/modules/cli/lib/installation/macos';
import { WindowsCliInstallationManager } from 'src/modules/cli/lib/installation/windows';

/**
 * Interface for platform-specific CLI installation management
 */
export interface StudioCliInstallationManager {
	isCliInstalled(): Promise< boolean >;
	installCliWithConfirmation(): Promise< void >;
	uninstallCliWithConfirmation(): Promise< void >;
}

function getCliInstallationManager(): StudioCliInstallationManager {
	switch ( process.platform ) {
		case 'darwin':
			return new MacOSCliInstallationManager();
		case 'win32':
			return new WindowsCliInstallationManager();
		default:
			throw new Error( 'Studio CLI is not available on this platform.' );
	}
}

function isPlatformSupported(): boolean {
	return process.platform === 'darwin' || process.platform === 'win32';
}

export async function isStudioCliInstalled(): Promise< boolean > {
	if ( isPlatformSupported() ) {
		const manager = getCliInstallationManager();
		return await manager.isCliInstalled();
	}
	return false;
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

	if ( isPlatformSupported() ) {
		const manager = getCliInstallationManager();
		await manager.installCliWithConfirmation();
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

	if ( isPlatformSupported() ) {
		const manager = getCliInstallationManager();
		await manager.uninstallCliWithConfirmation();
	}
}
