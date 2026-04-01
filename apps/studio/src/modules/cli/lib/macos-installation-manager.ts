import { dialog } from 'electron';
import { mkdir, readFile, readlink, symlink, unlink, lstat, writeFile } from 'node:fs/promises';
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

const PATH_EXPORT_LINE = 'export PATH="$HOME/.local/bin:$PATH"';

const SHELL_PROFILE_MAP: Record< string, string > = {
	'/bin/zsh': '.zshrc',
	'/bin/bash': '.bash_profile',
};
const DEFAULT_PROFILE = '.zshrc';

const ERROR_FILE_ALREADY_EXISTS = 'Studio CLI symlink path already occupied by non-symlink';

function isLocalBinInPath(): boolean {
	const localBinPath = path.join( os.homedir(), '.local', 'bin' );
	const pathEntries = ( process.env.PATH ?? '' ).split( ':' ).map( ( entry ) => {
		// Normalize entries: expand ~ and $HOME, then resolve to absolute path.
		const expanded = entry
			.replace( /^~(?=\/|$)/, os.homedir() )
			.replace( /\$HOME(?=\/|$)/, os.homedir() );
		return path.resolve( expanded );
	} );
	return pathEntries.includes( localBinPath );
}

export class MacOSCliInstallationManager implements StudioCliInstallationManager {
	constructor() {
		if ( process.platform !== 'darwin' ) {
			throw new Error( 'Use the appropriate installation manager for the current platform' );
		}
	}

	async isCliInstalled(): Promise< boolean > {
		if ( ! isLocalBinInPath() ) {
			return false;
		}

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

		const directoryPath = path.dirname( cliSymlinkPath );

		try {
			await unlink( cliSymlinkPath );
		} catch ( error ) {
			if ( ! isErrnoException( error ) || error.code !== 'ENOENT' ) {
				throw error;
			}
		}

		await mkdir( directoryPath, { recursive: true } );
		await symlink( cliPackagedPath, cliSymlinkPath );
		await this.ensurePathInProfile();
	}

	private async uninstallCli(): Promise< void > {
		try {
			const stats = await lstat( cliSymlinkPath );

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

		await unlink( cliSymlinkPath );
	}

	private async ensurePathInProfile(): Promise< void > {
		// If ~/.local/bin is already in PATH, no need to modify the shell profile.
		if ( isLocalBinInPath() ) {
			return;
		}

		const homeDir = os.homedir();
		const shell = process.env.SHELL ?? '';
		const profileFile = SHELL_PROFILE_MAP[ shell ] ?? DEFAULT_PROFILE;
		const profilePath = path.join( homeDir, profileFile );

		// Check if the export line is already present to avoid duplicates.
		let existingContent = '';
		try {
			existingContent = await readFile( profilePath, 'utf-8' );
		} catch {
			// File doesn't exist yet, which is fine.
		}

		if ( existingContent.includes( '$HOME/.local/bin' ) ) {
			return;
		}

		const lineToAppend =
			existingContent.endsWith( '\n' ) || existingContent === ''
				? `${ PATH_EXPORT_LINE }\n`
				: `\n${ PATH_EXPORT_LINE }\n`;

		await writeFile( profilePath, existingContent + lineToAppend, 'utf-8' );
	}

	private async getCurrentSymlinkDestination(): Promise< string | null > {
		try {
			return await readlink( cliSymlinkPath );
		} catch {
			return null;
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
