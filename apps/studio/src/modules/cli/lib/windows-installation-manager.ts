import { app, dialog } from 'electron';
import { mkdir, rm, writeFile } from 'fs/promises';
import { existsSync } from 'node:fs';
import path from 'path';
import * as Sentry from '@sentry/electron/main';
import { __ } from '@wordpress/i18n';
import Registry from 'winreg'; // don't update winreg to 1.2.5 - https://github.com/fresc81/node-winreg/issues/65
import { getMainWindow } from 'src/main-window';
import { StudioCliInstallationManager } from 'src/modules/cli/lib/ipc-handlers';

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
	 */
	async isCliInstalled(): Promise< boolean > {
		try {
			const isStudioCliDirInPath = await this.isStudioCliDirInPath();
			return isStudioCliDirInPath && existsSync( this.getStudioCliBinDir() );
		} catch ( error ) {
			console.error( 'Failed to check installation status of CLI', error );
			return false;
		}
	}

	async updateWindowsCliVersionedPathIfNeeded(): Promise< void > {
		if ( await this.isStudioCliDirInPath() ) {
			await this.installProxyBatFile();
		}
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
			Sentry.captureException( error );
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

	private getStudioCliBinDir(): string {
		if ( process.env.NODE_ENV !== 'production' && process.env.LOCALAPPDATA ) {
			return path.join( process.env.LOCALAPPDATA, 'studio', 'bin' );
		}
		return STABLE_BIN_DIR_PATH;
	}

	private async isStudioCliDirInPath(): Promise< boolean > {
		const currentPath = await this.getPathFromRegistry();
		return currentPath
			.split( ';' )
			.map( ( item ) => item.trim().toLowerCase() )
			.includes( this.getStudioCliBinDir().toLowerCase() );
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
				.concat( this.getStudioCliBinDir() )
				.join( ';' );

			await this.setPathInRegistry( updatedPath );
		} catch ( error ) {
			Sentry.captureException( error );
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
			const binDir = this.getStudioCliBinDir();
			await mkdir( binDir, { recursive: true } );

			const versionedCliPath = path.join(
				path.dirname( app.getPath( 'exe' ) ),
				'resources/bin/studio-cli.bat'
			);
			const relativeVersionedCliPath = path.relative( binDir, versionedCliPath );

			const content = `@echo off\n"%~dp0\\${ relativeVersionedCliPath }" %*`;

			await writeFile( path.join( binDir, 'studio.bat' ), content );
		} catch ( error ) {
			Sentry.captureException( error );
			console.error( 'Failed to install CLI: Proxy Bat file', error );
		}
	}

	private async installCli(): Promise< void > {
		await this.installPath();
		await this.installProxyBatFile();
	}

	private async uninstallCli(): Promise< void > {
		const binDir = this.getStudioCliBinDir();
		const currentPath = await this.getPathFromRegistry();
		const newPath = currentPath
			.split( ';' )
			.filter( ( item ) => item.trim().toLowerCase() !== binDir.toLowerCase() )
			.join( ';' );

		await this.setPathInRegistry( newPath );
		await rm( binDir, { recursive: true, force: true } );
	}
}

// See the `WindowsCliInstallationManager::installProxyBatFile` comment for more details
export async function updateWindowsCliVersionedPathIfNeeded() {
	if ( process.platform === 'win32' ) {
		const manager = new WindowsCliInstallationManager();
		await manager.updateWindowsCliVersionedPathIfNeeded();
	}
}
