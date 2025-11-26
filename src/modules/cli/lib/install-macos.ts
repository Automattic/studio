import { dialog } from 'electron';
import { mkdir, readlink, symlink, unlink, lstat } from 'node:fs/promises';
import path from 'node:path';
import * as Sentry from '@sentry/electron/main';
import { __, sprintf } from '@wordpress/i18n';
import { isErrnoException } from 'common/lib/is-errno-exception';
import { sudoExec } from 'src/lib/sudo-exec';
import { getMainWindow } from 'src/main-window';
import { getResourcesPath } from 'src/storage/paths';
import packageJson from '../../../../package.json';

const cliSymlinkPath = '/usr/local/bin/studio';

const binPath = path.join( getResourcesPath(), 'bin' );
const cliPackagedPath = path.join( binPath, 'studio-cli.sh' );
const installScriptPath = path.join( binPath, 'install-studio-cli.sh' );

const ERROR_WRONG_PLATFORM = 'Studio CLI is only available on macOS';
const ERROR_FILE_ALREADY_EXISTS = 'Studio CLI symlink path already occupied by non-symlink';
// Defined in @vscode/sudo-prompt
const ERROR_PERMISSION = 'User did not grant permission.';

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
		console.error( 'Failed to install CLI', error );

		let message: string = __(
			'There was an unknown error. Please check the logs for more information.'
		);

		// Don't report expected user errors to Sentry
		if ( error instanceof Error ) {
			if ( error.message === ERROR_FILE_ALREADY_EXISTS ) {
				message = sprintf(
					/* translators: 1: Installation path */
					__(
						'The installation path %1$s is already occupied by a file or directory. Please remove it and try again.'
					),
					cliSymlinkPath
				);
			} else if ( error.message === ERROR_PERMISSION ) {
				message = __( 'Please ensure you grant Studio admin permissions when prompted.' );
			} else if ( error.message !== ERROR_WRONG_PLATFORM ) {
				// Only report unexpected errors to Sentry
				Sentry.captureException( error );
			}
		} else {
			Sentry.captureException( error );
		}

		const mainWindow = await getMainWindow();
		await dialog.showMessageBox( mainWindow, {
			type: 'error',
			title: __( 'Failed to install CLI' ),
			message,
		} );
	}
}

// This function installs the Studio CLI on macOS. It creates a symlink at `cliSymlinkPath` pointing
// to the packaged Studio CLI JS file at `cliPackagedPath`.
async function installCLI(): Promise< void > {
	if ( process.platform !== 'darwin' ) {
		throw new Error( ERROR_WRONG_PLATFORM );
	}

	try {
		const stats = await lstat( cliSymlinkPath );

		if ( ! stats.isSymbolicLink() ) {
			throw new Error( ERROR_FILE_ALREADY_EXISTS );
		}
	} catch ( error ) {
		if ( isErrnoException( error ) && error.code === 'ENOENT' ) {
			// File does not exist, which means we can proceed with the installation.
		} else {
			throw error;
		}
	}

	const currentSymlinkDestination = await getCurrentSymlinkDestination();

	// The CLI is already installed.
	if ( currentSymlinkDestination === cliPackagedPath ) {
		return;
	}

	try {
		const directoryPath = path.dirname( cliSymlinkPath );

		await unlink( cliSymlinkPath );
		await mkdir( directoryPath, { recursive: true } );
		await symlink( cliPackagedPath, cliSymlinkPath );
	} catch ( e ) {
		// `/usr/local/bin` is not typically writable by non-root users, so in most cases, we run
		// this install script with admin privileges to create the symlink.
		await sudoExec( `/bin/sh "${ installScriptPath }"`, {
			name: packageJson.productName,
			env: {
				CLI_SYMLINK_PATH: cliSymlinkPath,
				CLI_PACKAGED_PATH: cliPackagedPath,
			},
		} );
	}
}

async function getCurrentSymlinkDestination(): Promise< string | null > {
	try {
		return await readlink( cliSymlinkPath );
	} catch {
		return null;
	}
}
