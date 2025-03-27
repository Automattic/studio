import { dialog } from 'electron';
import { mkdir, readlink, symlink, unlink } from 'node:fs/promises';
import path from 'node:path';
import { __ } from '@wordpress/i18n';
import { sudoExec } from 'src/lib/sudo-exec';
import { getMainWindow } from 'src/main-window';
import { getResourcesPath } from 'src/storage/paths';
import packageJson from '../../package.json';

const cliSymlinkPath = '/usr/local/bin/studio';

const binPath = path.join( getResourcesPath(), 'bin' );
const cliTargetPath = path.join( binPath, 'studio-cli.sh' );
const installMacosStudioCliSymlinkScript = path.join( binPath, 'install-macos-studio-cli-symlink.sh' );

export async function installMacOsStudioCLI() {
	try {
		await installCLI();
		const mainWindow = await getMainWindow();
		await dialog.showMessageBox( mainWindow, {
			type: 'info',
			title: __( 'CLI Installed' ),
			message: __( 'The CLI has been installed successfully.' ),
		} );
	} catch ( error ) {
		console.error( 'Failed to install CLI', error );

		const mainWindow = await getMainWindow();
		await dialog.showMessageBox( mainWindow, {
			type: 'error',
			title: __( 'Failed to install CLI' ),
			message: __(
				'Please try again and ensure you grant Studio admin permissions when prompted.'
			),
		} );
	}
}

async function installCLI(): Promise< void > {
	if ( process.platform !== 'darwin' ) {
		return;
	}

	const currentSymlinkTargetPath = await getCurrentSymlinkTargetPath();
	const isSymlinkUpToDate = currentSymlinkTargetPath === cliTargetPath;

	if ( isSymlinkUpToDate ) {
		return;
	}

	try {
		// Try to create symlink
		const directoryPath = path.dirname( cliSymlinkPath );

		await unlink( cliSymlinkPath );
		await mkdir( directoryPath, { recursive: true } );
		await symlink( cliTargetPath, cliSymlinkPath );
	} catch ( e ) {
		// If symlink fails (usually because of permission issues writing to /usr/local/bin), try to do the same with sudo
		await sudoExec( `/bin/sh "${ installMacosStudioCliSymlinkScript }"`, {
			name: packageJson.productName,
			env: {
				CLI_SYMLINK_PATH: cliSymlinkPath,
				CLI_TARGET_PATH: cliTargetPath,
			},
		} );
	}
}

async function getCurrentSymlinkTargetPath(): Promise< string | null > {
	try {
		return await readlink( cliSymlinkPath );
	} catch {
		return null;
	}
}
