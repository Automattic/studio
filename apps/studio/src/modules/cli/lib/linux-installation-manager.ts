import { dialog } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as Sentry from '@sentry/electron/main';
import { isErrnoException } from '@studio/common/lib/is-errno-exception';
import { __, sprintf } from '@wordpress/i18n';
import { getMainWindow } from 'src/main-window';
import { StudioCliInstallationManager } from 'src/modules/cli/lib/ipc-handlers';
import { getResourcesPath } from 'src/storage/paths';
import { loadUserData, updateAppdata } from 'src/storage/user-data';

const cliSymlinkPath = path.join( os.homedir(), '.local', 'bin', 'studio' );

const binPath = path.join( getResourcesPath(), 'bin' );
const cliPackagedPath = path.join( binPath, 'studio-cli.sh' );

// Production install path for the Studio DEB package. Used in development mode to detect
// whether a production CLI is already installed alongside the running dev build.
const PROD_CLI_PACKAGED_PATH = '/usr/lib/studio/resources/bin/studio-cli.sh';

const SUPPORTED_SHELLS = [ 'bash', 'zsh' ] as const;
const SHELL_PROFILE_MAP: Record< ( typeof SUPPORTED_SHELLS )[ number ], string > = {
	bash: '.bashrc',
	zsh: '.zshrc',
};
const DEFAULT_PROFILE = SHELL_PROFILE_MAP[ 'bash' ];
const PATH_DEFINITION = '$HOME/.local/bin';
const PATH_EXPORT_LINE = `export PATH="${ PATH_DEFINITION }:$PATH"`;

const ERROR_FILE_ALREADY_EXISTS = 'Studio CLI symlink path already occupied by non-symlink';

export class LinuxCliInstallationManager implements StudioCliInstallationManager {
	constructor() {
		if ( process.platform !== 'linux' ) {
			throw new Error( 'Use the appropriate installation manager for the current platform' );
		}
	}

	async isCliInstalled(): Promise< boolean > {
		const existingContent = await this.readShellProfileContent();

		if ( ! existingContent.includes( PATH_DEFINITION ) ) {
			return false;
		}

		// A standalone (curl) install is managed outside the app: report it as
		// installed — matching the Windows manager — so the UI doesn't offer an
		// install that would silently no-op. We never install over or uninstall it.
		if ( await this.isExternallyManagedCli( cliSymlinkPath ) ) {
			return true;
		}

		return await this.doesSymlinkLeadToPackagedCli( cliSymlinkPath );
	}

	async installCliWithConfirmation(): Promise< void > {
		try {
			await this.installCli();
			await updateAppdata( { cliUserUninstalled: false } );
		} catch ( error ) {
			console.error( 'Failed to install CLI', error );

			let message: string = __(
				'There was an unknown error. Please check the logs for more information.'
			);

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
			await updateAppdata( { cliUserUninstalled: true } );
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
		const userData = await loadUserData();
		if ( userData.cliUserUninstalled ) {
			return;
		}

		await this.installCli();
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

		// Never overwrite a CLI the app didn't install — e.g. a standalone curl
		// install symlinking studio at <STUDIO_CLI_HOME>/bin/studio (any location).
		if ( await this.isExternallyManagedCli( cliSymlinkPath ) ) {
			return;
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
				return;
			}
			throw error;
		}

		// Don't remove a CLI the app didn't install (e.g. a standalone curl install).
		if ( await this.isExternallyManagedCli( cliSymlinkPath ) ) {
			return;
		}

		await fs.promises.unlink( cliSymlinkPath );
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
		const shell = path.basename( os.userInfo().shell ?? process.env.SHELL ?? '' );
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

	private async isExternallyManagedCli( symlinkPath: string ): Promise< boolean > {
		let isSymlink = false;
		try {
			isSymlink = ( await fs.promises.lstat( symlinkPath ) ).isSymbolicLink();
		} catch {
			return false;
		}
		if ( ! isSymlink ) {
			return false;
		}
		// A dangling symlink (e.g. a standalone install that was deleted without
		// removing the link) is broken, not externally managed — reclaim it so a
		// reinstall can repair `studio` instead of refusing to touch it.
		try {
			await fs.promises.stat( symlinkPath );
		} catch {
			return false;
		}
		// A symlink that doesn't point at our packaged CLI is managed outside the
		// app (e.g. a standalone curl install at <STUDIO_CLI_HOME>/bin/studio, any
		// location). Treat it as installed and never overwrite it.
		return ! ( await this.doesSymlinkLeadToPackagedCli( symlinkPath ) );
	}

	private async doesSymlinkLeadToPackagedCli( symlinkPath: string ): Promise< boolean > {
		try {
			const symlinkDestination = await fs.promises.readlink( symlinkPath );

			if (
				process.env.NODE_ENV !== 'production' &&
				symlinkDestination === PROD_CLI_PACKAGED_PATH
			) {
				return true;
			}

			return symlinkDestination === cliPackagedPath;
		} catch {
			return false;
		}
	}
}

export async function autoInstallLinuxCliIfNeeded(): Promise< void > {
	if ( process.platform !== 'linux' || process.env.NODE_ENV !== 'production' || process.env.E2E ) {
		return;
	}

	try {
		const manager = new LinuxCliInstallationManager();
		await manager.autoInstallIfNeeded();
	} catch ( error ) {
		console.error( 'Failed to auto-install Linux CLI', error );
		Sentry.captureException( error );
	}
}
