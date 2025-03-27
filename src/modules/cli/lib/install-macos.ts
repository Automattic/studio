import { dialog } from 'electron';
import { mkdir, readlink, symlink, unlink } from 'node:fs/promises';
import path from 'node:path';
import * as Sentry from '@sentry/electron/main';
import { __ } from '@wordpress/i18n';
import { sudoExec } from 'src/lib/sudo-exec';
import { getMainWindow } from 'src/main-window';
import { getResourcesPath } from 'src/storage/paths';
import packageJson from '../../../../package.json';

const cliSymlinkSource = '/usr/local/bin/studio';

const binPath = path.join( getResourcesPath(), 'bin' );
const cliSymlinkTarget = path.join( binPath, 'studio-cli.sh' );
const installScriptPath = path.join( binPath, 'install-studio-cli.sh' );

export async function installCLIOnMacOSWithConfirmation() {
	try {
		await installCLI();
		const mainWindow = await getMainWindow();
		await dialog.showMessageBox( mainWindow, {
			type: 'info',
			title: __( 'CLI Installed' ),
			message: __( 'The CLI has been installed successfully.' ),
		} );
	} catch ( error ) {
		Sentry.captureException( error );
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

// This function installs the Studio CLI on macOS. It creates a symlink at `cliSymlinkSource`
// pointing to the packaged Studio CLI JS file at `cliSymlinkTarget`.
async function installCLI(): Promise< void > {
	if ( process.platform !== 'darwin' ) {
		return;
	}

	const currentSymlinkTarget = await getCurrentSymlinkTarget();

	if ( currentSymlinkTarget === cliSymlinkTarget ) {
		return;
	}

	try {
		const directoryPath = path.dirname( cliSymlinkSource );

		await unlink( cliSymlinkSource );
		await mkdir( directoryPath, { recursive: true } );
		await symlink( cliSymlinkTarget, cliSymlinkSource );
	} catch ( e ) {
		// `/usr/local/bin` is not typically writable by non-root users, so in most cases, we run
		// this install script with admin privileges to create the symlink.
		await sudoExec( `/bin/sh "${ installScriptPath }"`, {
			name: packageJson.productName,
			env: {
				CLI_SYMLINK_SOURCE: cliSymlinkSource,
				CLI_SYMLINK_TARGET: cliSymlinkTarget,
			},
		} );
	}
}

async function getCurrentSymlinkTarget(): Promise< string | null > {
	try {
		return await readlink( cliSymlinkSource );
	} catch {
		return null;
	}
}
