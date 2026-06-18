import { app, dialog } from 'electron';
import { mkdir, rm, writeFile } from 'fs/promises';
import { existsSync } from 'node:fs';
import path from 'path';
import * as Sentry from '@sentry/electron/main';
import { __ } from '@wordpress/i18n';
import Registry from 'winreg'; // don't update winreg to 1.2.5 - https://github.com/fresc81/node-winreg/issues/65
import { getMainWindow } from 'src/main-window';
import { StudioCliInstallationManager } from 'src/modules/cli/lib/ipc-handlers';
import { loadUserData, updateAppdata } from 'src/storage/user-data';

// `STABLE_BIN_DIR_PATH` resolves to C:\Users\<USERNAME>\AppData\Local\studio\bin
export const STABLE_BIN_DIR_PATH = path.resolve( path.dirname( app.getPath( 'exe' ) ), '../bin' );

const PATH_KEY = 'Path';

const currentUserRegistry = new Registry( {
	hive: Registry.HKCU,
	key: '\\Environment',
} );

export class WindowsCliInstallationManager implements StudioCliInstallationManager {
	constructor() {
		if ( process.platform !== 'win32' ) {
			throw new Error( 'Use the appropriate installation manager for the current platform' );
		}
	}

	/**
	 * Check if the stable bin directory has been created and if it's contained in the registry PATH.
	 * Also detects standalone CLI installed via install.ps1.
	 */
	async isCliInstalled(): Promise< boolean > {
		try {
			if ( await this.isStandaloneCli() ) {
				return true;
			}
			const isStudioCliDirInPath = await this.isStudioCliDirInPath();
			return isStudioCliDirInPath && existsSync( STABLE_BIN_DIR_PATH );
		} catch ( error ) {
			console.error( 'Failed to check installation status of CLI', error );
			return false;
		}
	}

	async autoInstallIfNeeded(): Promise< void > {
		const userData = await loadUserData();
		if ( userData.cliUserUninstalled ) {
			return;
		}

		if ( await this.isCliInstalled() ) {
			// Update the proxy bat file to point at the current app version.
			await this.updateWindowsCliVersionedPathIfNeeded();
			return;
		}

		await this.installCli();
	}

	async installCliWithConfirmation(): Promise< void > {
		try {
			await this.installCli();
			await updateAppdata( { cliUserUninstalled: false } );
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

			if ( error instanceof Error ) {
				message = error.message;
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

	private getPathFromRegistry(): Promise< string > {
		return new Promise( ( resolve, reject ) => {
			currentUserRegistry.get( PATH_KEY, ( error, item ) => {
				if ( error ) {
					return reject( error );
				}

				resolve( item?.value || '' );
			} );
		} );
	}

	private setPathInRegistry( updatedPath: string ): Promise< void > {
		return new Promise( ( resolve, reject ) => {
			currentUserRegistry.set( PATH_KEY, Registry.REG_EXPAND_SZ, updatedPath, ( error ) => {
				if ( error ) {
					return reject( error );
				}

				resolve();
			} );
		} );
	}

	private async isStudioCliDirInPath(): Promise< boolean > {
		let studioCliDir = STABLE_BIN_DIR_PATH;

		// Return true if we are running the development version of the app and the production CLI is installed
		if ( process.env.NODE_ENV !== 'production' && process.env.LOCALAPPDATA ) {
			studioCliDir = path.join( process.env.LOCALAPPDATA, 'studio', 'bin' );
		}

		const currentPath = await this.getPathFromRegistry();
		return currentPath
			.split( ';' )
			.map( ( item ) => item.trim().toLowerCase() )
			.includes( studioCliDir.toLowerCase() );
	}

	private async installPath(): Promise< void > {
		try {
			if ( await this.isStudioCliDirInPath() ) {
				return;
			}

			const currentPath = await this.getPathFromRegistry();
			const updatedPath = currentPath
				.split( ';' )
				.map( ( p ) => p.trim() )
				.filter( Boolean )
				.concat( STABLE_BIN_DIR_PATH )
				.join( ';' );

			await this.setPathInRegistry( updatedPath );
		} catch ( error ) {
			console.error( 'Failed to install CLI path', error );
		}
	}

	/**
	 * Creates the stable bin directory and write a proxy batch file that will handle CLI execution.
	 *
	 * Since our app is installed in a versioned directory, the full path changes with each update.
	 * Instead of adding the versioned executable directly to PATH, we create a fixed proxy script
	 * in the AppData directory that forwards execution to the current version's CLI entry point.
	 */
	private async installProxyBatFile(): Promise< void > {
		try {
			await mkdir( STABLE_BIN_DIR_PATH, { recursive: true } );

			const versionedCliPath = path.join(
				path.dirname( app.getPath( 'exe' ) ),
				'resources/bin/studio-cli.bat'
			);
			const relativeVersionedCliPath = path.relative( STABLE_BIN_DIR_PATH, versionedCliPath );

			const content = `@echo off\n"%~dp0\\${ relativeVersionedCliPath }" %*`;

			await writeFile( path.join( STABLE_BIN_DIR_PATH, 'studio.bat' ), content );
		} catch ( error ) {
			console.error( 'Failed to install CLI: Proxy Bat file', error );
		}
	}

	/**
	 * Check if a standalone CLI (installed via install.ps1) is present.
	 * Detects the standalone launcher and its bundled Node binary in the
	 * default or custom install path. Requiring both files means a broken
	 * install (e.g. a launcher without its runtime) is not treated as
	 * standalone, so the app can still install its own CLI.
	 */
	private async isStandaloneCli(): Promise< boolean > {
		const currentPath = await this.getPathFromRegistry();
		const pathDirs = currentPath
			.split( ';' )
			.map( ( item ) => item.trim() )
			.filter( Boolean );

		for ( const dir of pathDirs ) {
			// Skip the app's own bin directory
			if ( dir.toLowerCase() === STABLE_BIN_DIR_PATH.toLowerCase() ) {
				continue;
			}
			const launcherPath = path.join( dir, 'studio.cmd' );
			const bundledNodePath = path.join( dir, 'node.exe' );
			if ( existsSync( launcherPath ) && existsSync( bundledNodePath ) ) {
				return true;
			}
		}
		return false;
	}

	private async installCli(): Promise< void > {
		// Don't overwrite standalone CLI installed via install.ps1
		if ( await this.isStandaloneCli() ) {
			return;
		}
		await this.installPath();
		await this.installProxyBatFile();
	}

	private async updateWindowsCliVersionedPathIfNeeded(): Promise< void > {
		if ( await this.isStudioCliDirInPath() ) {
			await this.installProxyBatFile();
		}
	}

	private async uninstallCli(): Promise< void > {
		const currentPath = await this.getPathFromRegistry();
		const newPath = currentPath
			.split( ';' )
			.filter( ( item ) => item.trim().toLowerCase() !== STABLE_BIN_DIR_PATH.toLowerCase() )
			.join( ';' );

		await this.setPathInRegistry( newPath );
		if ( process.env.NODE_ENV === 'production' ) {
			await rm( STABLE_BIN_DIR_PATH, { recursive: true, force: true } );
		}
	}
}

export async function autoInstallWindowsCliIfNeeded(): Promise< void > {
	if ( process.platform !== 'win32' || process.env.NODE_ENV !== 'production' ) {
		return;
	}

	try {
		const manager = new WindowsCliInstallationManager();
		await manager.autoInstallIfNeeded();
	} catch ( error ) {
		console.error( 'Failed to auto-install Windows CLI', error );
		Sentry.captureException( error );
	}
}
