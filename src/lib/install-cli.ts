import { app, dialog } from 'electron';
import { mkdir, readlink, symlink, unlink } from 'node:fs/promises';
import path from 'node:path';
import { __ } from '@wordpress/i18n';
import { sudoExec } from 'src/lib/sudo-exec';
import { getMainWindow } from 'src/main-window';
import packageJson from '../../package.json';

const installedCLIPath = '/usr/local/bin/studio';

const binPath = app.isPackaged
	? path.resolve( app.getAppPath(), '../bin' )
	: path.resolve( app.getAppPath(), 'bin' );
const packagedPath = path.join( binPath, 'studio-cli.sh' );
const installScriptPath = path.join( binPath, 'install-studio-cli.sh' );

export async function installCLIAction() {
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

// Install the command line tool on macOS.
async function installCLI(): Promise< void > {
	if ( process.platform !== 'darwin' ) {
		return;
	}

	const installedPath = await getResolvedInstallPath();

	if ( installedPath === packagedPath ) {
		return;
	}

	try {
		const directoryPath = path.dirname( installedCLIPath );

		await unlink( installedCLIPath );
		await mkdir( directoryPath, { recursive: true } );
		await symlink( packagedPath, installedCLIPath );
	} catch ( e ) {
		await sudoExec( `/bin/sh "${ installScriptPath }"`, {
			name: packageJson.productName,
			env: {
				INSTALLED_CLI_PATH: installedCLIPath,
				PACKAGED_PATH: packagedPath,
			},
		} );
	}
}

async function getResolvedInstallPath(): Promise< string | null > {
	try {
		return await readlink( installedCLIPath );
	} catch {
		return null;
	}
}
