import {
	installCliWithConfirmation as installCliMacOS,
	isCliInstalled as isCliInstalledMacOS,
	uninstallCliWithConfirmation as uninstallCliOnMacOS,
} from 'src/modules/cli/lib/installation/darwin';
import {
	installCli as installCliOnWindows,
	isCliInstalled as isCliInstalledWindows,
	uninstallCli as uninstallCliOnWindows,
} from 'src/modules/cli/lib/installation/win32';

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
	if ( process.platform === 'darwin' ) {
		await installCliMacOS();
	} else if ( process.platform === 'win32' ) {
		await installCliOnWindows();
	}
}

export async function uninstallStudioCli(): Promise< void > {
	if ( process.platform === 'darwin' ) {
		await uninstallCliOnMacOS();
	} else if ( process.platform === 'win32' ) {
		await uninstallCliOnWindows();
	}
}
