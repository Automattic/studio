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

export async function showCliErrorDialog( title: string, message: string ): Promise< void > {
	const mainWindow = await getMainWindow();
	await dialog.showMessageBox( mainWindow, { type: 'error', title, message } );
}

export async function showCliInfoDialog( title: string, message: string ): Promise< void > {
	const mainWindow = await getMainWindow();
	await dialog.showMessageBox( mainWindow, { type: 'info', title, message } );
}

export async function runCliAutoInstall(
	platformLabel: string,
	shouldRun: boolean,
	createManager: () => { autoInstallIfNeeded(): Promise< void > }
): Promise< void > {
	if ( ! shouldRun ) {
		return;
	}

	try {
		await createManager().autoInstallIfNeeded();
	} catch ( error ) {
		console.error( `Failed to auto-install ${ platformLabel } CLI`, error );
		Sentry.captureException( error );
	}
}

const cliSymlinkPath = path.join( os.homedir(), '.local', 'bin', 'studio' );
const cliPackagedPath = path.join( getResourcesPath(), 'bin', 'studio-cli.sh' );

const PATH_DEFINITION = '$HOME/.local/bin';
const PATH_EXPORT_LINE = `export PATH="${ PATH_DEFINITION }:$PATH"`;
const ERROR_FILE_ALREADY_EXISTS = 'Studio CLI symlink path already occupied by non-symlink';

export async function doesSymlinkLeadToPackagedCli(
	symlinkPath: string,
	prodCliPackagedPath: string
): Promise< boolean > {
	try {
		const symlinkDestination = await fs.promises.readlink( symlinkPath );

		if ( process.env.NODE_ENV !== 'production' && symlinkDestination === prodCliPackagedPath ) {
			return true;
		}

		return symlinkDestination === cliPackagedPath;
	} catch {
		return false;
	}
}

export interface UnixCliConfig {
	platform: 'darwin' | 'linux';
	shellProfiles: Record< string, string >;
	defaultProfile: string;
	prodCliPackagedPath: string;
	onUninstalled?: () => Promise< void >;
}

export class UnixCliInstallationManager implements StudioCliInstallationManager {
	constructor( private readonly config: UnixCliConfig ) {
		if ( process.platform !== config.platform ) {
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

		return await doesSymlinkLeadToPackagedCli( cliSymlinkPath, this.config.prodCliPackagedPath );
	}

	async isCliExternallyManaged(): Promise< boolean > {
		return await this.isExternallyManagedCli( cliSymlinkPath );
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
					Sentry.captureException( error );
				}
			} else {
				Sentry.captureException( error );
			}

			await showCliErrorDialog( __( 'Failed to install CLI' ), message );
		}
	}

	async uninstallCliWithConfirmation(): Promise< void > {
		try {
			await this.uninstallCli();
			await this.config.onUninstalled?.();
			await updateAppdata( { cliUserUninstalled: true } );
			await showCliInfoDialog(
				__( 'CLI uninstalled' ),
				__( 'The CLI has been uninstalled successfully.' )
			);
		} catch ( error ) {
			Sentry.captureException( error );
			console.error( 'Failed to uninstall CLI', error );

			let message: string = __(
				'There was an unknown error. Please check the logs for more information.'
			);

			if ( error instanceof Error ) {
				message = error.message;
			}

			await showCliErrorDialog( __( 'Failed to uninstall CLI' ), message );
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
				// File does not exist, nothing to uninstall.
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
		const profileFile = this.config.shellProfiles[ shell ] ?? this.config.defaultProfile;
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
		return ! ( await doesSymlinkLeadToPackagedCli( symlinkPath, this.config.prodCliPackagedPath ) );
	}
}
