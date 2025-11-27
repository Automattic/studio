import { dialog } from 'electron';
import { mkdir, readlink, symlink, unlink, lstat } from 'node:fs/promises';
import path from 'node:path';
import * as Sentry from '@sentry/electron/main';
import { __, sprintf } from '@wordpress/i18n';
import { isErrnoException } from 'common/lib/is-errno-exception';
import { sudoExec } from 'src/lib/sudo-exec';
import { getMainWindow } from 'src/main-window';
import { StudioCliInstallationManager } from 'src/modules/cli/lib/installation/index';
import { getResourcesPath } from 'src/storage/paths';
import packageJson from '../../../../../package.json';

const cliSymlinkPath = '/usr/local/bin/studio';

const binPath = path.join( getResourcesPath(), 'bin' );
const cliPackagedPath = path.join( binPath, 'studio-cli.sh' );
const installScriptPath = path.join( binPath, 'install-studio-cli.sh' );
const uninstallScriptPath = path.join( binPath, 'uninstall-studio-cli.sh' );

const ERROR_FILE_ALREADY_EXISTS = 'Studio CLI symlink path already occupied by non-symlink';
// Defined in @vscode/sudo-prompt
const ERROR_PERMISSION = 'User did not grant permission.';

export class MacOSCliInstallationManager implements StudioCliInstallationManager {
	constructor() {
		if ( process.platform !== 'darwin' ) {
			throw new Error( 'Use the appropriate installation manager for the current platform' );
		}
	}

	async isCliInstalled(): Promise< boolean > {
		const currentSymlinkDestination = await this.getCurrentSymlinkDestination();

		// Return true if we are running the development version of the app and the production CLI is installed
		if ( process.env.NODE_ENV !== 'production' ) {
			const prodCliPackagedPath = path.join(
				path.sep,
				'Applications',
				'Studio.app',
				'Contents',
				'Resources',
				'bin',
				'studio-cli.sh'
			);
			if ( currentSymlinkDestination === prodCliPackagedPath ) {
				return true;
			}
		}

		return currentSymlinkDestination === cliPackagedPath;
	}

	async installCliWithConfirmation(): Promise< void > {
		try {
			await this.installCli();
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
				} else {
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

	async uninstallCliWithConfirmation(): Promise< void > {
		try {
			await this.uninstallCli();
			const mainWindow = await getMainWindow();
			await dialog.showMessageBox( mainWindow, {
				type: 'info',
				title: __( 'CLI Uninstalled' ),
				message: __( 'The CLI has been uninstalled successfully.' ),
			} );
		} catch ( error ) {
			Sentry.captureException( error );
			console.error( 'Failed to uninstall CLI', error );

			let message: string = __(
				'There was an unknown error. Please check the logs for more information.'
			);

			if ( error instanceof Error ) {
				message = error.message;
			}

			const mainWindow = await getMainWindow();
			await dialog.showMessageBox( mainWindow, {
				type: 'error',
				title: __( 'Failed to uninstall CLI' ),
				message,
			} );
		}
	}

	private async installCli(): Promise< void > {
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

		if ( await this.isCliInstalled() ) {
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

	private async uninstallCli(): Promise< void > {
		try {
			const stats = await lstat( cliSymlinkPath );

			if ( ! stats.isSymbolicLink() ) {
				throw new Error( ERROR_FILE_ALREADY_EXISTS );
			}
		} catch ( error ) {
			if ( isErrnoException( error ) && error.code === 'ENOENT' ) {
				// File does not exist, which means we can proceed
			} else {
				throw error;
			}
		}

		try {
			await unlink( cliSymlinkPath );
		} catch ( error ) {
			// `/usr/local/bin` is not typically writable by non-root users, so in most cases, we run
			// this uninstall script with admin privileges to remove the symlink.
			await sudoExec( `/bin/sh "${ uninstallScriptPath }"`, {
				name: packageJson.productName,
				env: {
					CLI_SYMLINK_PATH: cliSymlinkPath,
				},
			} );
		}
	}

	private async getCurrentSymlinkDestination(): Promise< string | null > {
		try {
			return await readlink( cliSymlinkPath );
		} catch {
			return null;
		}
	}
}
