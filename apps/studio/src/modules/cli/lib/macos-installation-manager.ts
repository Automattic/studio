import { dialog } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as Sentry from '@sentry/electron/main';
import { isErrnoException } from '@studio/common/lib/is-errno-exception';
import { __, sprintf } from '@wordpress/i18n';
import { sudoExec } from 'src/lib/sudo-exec';
import { getMainWindow } from 'src/main-window';
import { StudioCliInstallationManager } from 'src/modules/cli/lib/ipc-handlers';
import { getResourcesPath } from 'src/storage/paths';
import { loadUserData, updateAppdata } from 'src/storage/user-data';
import packageJson from '../../../../package.json';

const legacyCliSymlinkPath = '/usr/local/bin/studio';
const cliSymlinkPath = path.join( os.homedir(), '.local', 'bin', 'studio' );

const binPath = path.join( getResourcesPath(), 'bin' );
const cliPackagedPath = path.join( binPath, 'studio-cli.sh' );
const uninstallScriptPath = path.join( binPath, 'uninstall-studio-cli.sh' );

const SUPPORTED_SHELLS = [ '/bin/zsh', '/bin/bash' ] as const;
const SHELL_PROFILE_MAP: Record< ( typeof SUPPORTED_SHELLS )[ number ], string > = {
	'/bin/zsh': '.zshrc',
	'/bin/bash': '.bash_profile',
};
const DEFAULT_PROFILE = SHELL_PROFILE_MAP[ '/bin/zsh' ];
const PATH_DEFINITION = '$HOME/.local/bin';
const PATH_EXPORT_LINE = `export PATH="${ PATH_DEFINITION }:$PATH"`;

const ERROR_FILE_ALREADY_EXISTS = 'Studio CLI symlink path already occupied by non-symlink';

export class MacOSCliInstallationManager implements StudioCliInstallationManager {
	constructor() {
		if ( process.platform !== 'darwin' ) {
			throw new Error( 'Use the appropriate installation manager for the current platform' );
		}
	}

	async isCliInstalled(): Promise< boolean > {
		const existingContent = await this.readShellProfileContent();

		if ( ! existingContent.includes( PATH_DEFINITION ) ) {
			return false;
		}

		return await this.doesSymlinkLeadToPackagedCli( cliSymlinkPath );
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
			await this.uninstallLegacyCliIfNeeded();
			const mainWindow = await getMainWindow();
			await dialog.showMessageBox( mainWindow, {
				type: 'info',
				title: __( 'CLI uninstalled' ),
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

	async autoInstallIfNeeded(): Promise< void > {
		// Only auto-install on first launch. If the flag is already set but the CLI isn't
		// installed, the user must have explicitly disabled it — respect their choice.
		const userData = await loadUserData();
		if ( userData.cliAutoInstalled ) {
			return;
		}

		await this.installCli();
		await updateAppdata( { cliAutoInstalled: true } );
	}

	private async installCli(): Promise< void > {
		try {
			const stats = await fs.promises.lstat( cliSymlinkPath );

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

		const directoryPath = path.dirname( cliSymlinkPath );

		try {
			await fs.promises.unlink( cliSymlinkPath );
		} catch ( error ) {
			if ( ! isErrnoException( error ) || error.code !== 'ENOENT' ) {
				throw error;
			}
		}

		await fs.promises.mkdir( directoryPath, { recursive: true } );
		await fs.promises.symlink( cliPackagedPath, cliSymlinkPath );
		await this.ensurePathInProfile();
	}

	private async uninstallCli(): Promise< void > {
		try {
			const stats = await fs.promises.lstat( cliSymlinkPath );

			if ( ! stats.isSymbolicLink() ) {
				throw new Error( ERROR_FILE_ALREADY_EXISTS );
			}
		} catch ( error ) {
			if ( isErrnoException( error ) && error.code === 'ENOENT' ) {
				// File does not exist, nothing to uninstall.
				return;
			}
			throw error;
		}

		await fs.promises.unlink( cliSymlinkPath );
	}

	private async uninstallLegacyCliIfNeeded(): Promise< void > {
		const legacyCliExists = await this.doesSymlinkLeadToPackagedCli( legacyCliSymlinkPath );
		if ( ! legacyCliExists ) {
			return;
		}

		try {
			await fs.promises.unlink( legacyCliSymlinkPath );
		} catch ( error ) {
			// `/usr/local/bin` is not typically writable by non-root users, so in most cases, we run
			// this uninstall script with admin privileges to remove the symlink.
			await sudoExec( `/bin/sh "${ uninstallScriptPath }"`, {
				name: packageJson.productName,
				env: {
					CLI_SYMLINK_PATH: legacyCliSymlinkPath,
				},
			} );
		}
	}

	private async ensurePathInProfile(): Promise< void > {
		const existingContent = await this.readShellProfileContent();

		if ( existingContent.includes( PATH_DEFINITION ) ) {
			return;
		}

		const profilePath = this.getShellProfilePath();

		const lineToAppend =
			existingContent.endsWith( '\n' ) || existingContent === ''
				? `${ PATH_EXPORT_LINE }\n`
				: `\n${ PATH_EXPORT_LINE }\n`;

		await fs.promises.writeFile( profilePath, existingContent + lineToAppend, 'utf-8' );
	}

	private getShellProfilePath(): string {
		const shell = process.env.SHELL ?? '';
		const supportedShell = SUPPORTED_SHELLS.find( ( candidate ) => candidate === shell );
		const profileFile = supportedShell ? SHELL_PROFILE_MAP[ supportedShell ] : DEFAULT_PROFILE;
		return path.join( os.homedir(), profileFile );
	}

	private async readShellProfileContent(): Promise< string > {
		try {
			return await fs.promises.readFile( this.getShellProfilePath(), 'utf-8' );
		} catch ( error ) {
			if ( isErrnoException( error ) && error.code === 'ENOENT' ) {
				return '';
			}
			throw error;
		}
	}

	private async doesSymlinkLeadToPackagedCli( symlinkPath: string ): Promise< boolean > {
		try {
			const symlinkDestination = await fs.promises.readlink( symlinkPath );

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

				return symlinkDestination === prodCliPackagedPath;
			}

			return symlinkDestination === cliPackagedPath;
		} catch {
			return false;
		}
	}
}

export async function autoInstallMacOSCliIfNeeded(): Promise< void > {
	if ( process.platform !== 'darwin' || process.env.NODE_ENV !== 'production' ) {
		return;
	}

	try {
		const manager = new MacOSCliInstallationManager();
		await manager.autoInstallIfNeeded();
	} catch ( error ) {
		console.error( 'Failed to auto-install macOS CLI', error );
		Sentry.captureException( error );
	}
}
