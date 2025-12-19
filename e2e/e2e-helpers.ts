import { randomUUID } from 'crypto';
import fsSync from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { findLatestBuild, parseElectronApp } from 'electron-playwright-helpers';
import fs from 'fs-extra';
import { _electron as electron, Page, ElectronApplication } from 'playwright';

export class E2ESession {
	electronApp: ElectronApplication;
	mainWindow: Page;

	sessionPath: string;
	appDataPath: string;
	homePath: string;

	public constructor() {
		// Create temporary folder to hold application data
		this.sessionPath = path.join( tmpdir(), `studio-app-e2e-session-${ randomUUID() }` );
		this.appDataPath = path.join( this.sessionPath, 'appData' );
		this.homePath = path.join( this.sessionPath, 'home' );
	}

	async launch( testEnv: NodeJS.ProcessEnv = {} ) {
		await fs.mkdir( this.appDataPath, { recursive: true } );
		await fs.mkdir( this.homePath, { recursive: true } );

		// Pre-create appdata file with beta features enabled for CLI testing
		// Path must include 'Studio' subfolder to match Electron app's path structure
		const studioAppDataPath = path.join( this.appDataPath, 'Studio' );
		await fs.mkdir( studioAppDataPath, { recursive: true } );
		const appdataPath = path.join( studioAppDataPath, 'appdata-v1.json' );
		const initialAppdata = {
			version: 1,
			sites: [],
			snapshots: [],
			betaFeatures: {
				studioSitesCli: true,
			},
		};
		await fs.writeFile( appdataPath, JSON.stringify( initialAppdata, null, 2 ) );

		// find the latest build in the out directory
		const latestBuild = findLatestBuild();

		// parse the packaged Electron app and find paths and other info
		const appInfo = parseElectronApp( latestBuild );
		let executablePath = appInfo.executable;
		if ( appInfo.platform === 'win32' ) {
			// `parseElectronApp` function obtains the executable path by finding the first executable from the build folder.
			// We need to ensure that the executable is the Studio app.
			executablePath = executablePath.replace( 'Squirrel.exe', 'Studio.exe' );
		}

		this.electronApp = await electron.launch( {
			args: [ appInfo.main ], // main file from package.json
			executablePath, // path to the Electron executable
			env: {
				...process.env,
				...testEnv,
				E2E: 'true', // allow app to determine whether it's running as an end-to-end test
				E2E_APP_DATA_PATH: this.appDataPath,
				E2E_HOME_PATH: this.homePath,
			},
			timeout: 60_000,
		} );
		this.mainWindow = await this.electronApp.firstWindow( { timeout: 60_000 } );
	}

	// Close the app but keep the data for persistence testing
	async restart() {
		await this.electronApp?.close();
		const latestBuild = findLatestBuild();
		const appInfo = parseElectronApp( latestBuild );
		let executablePath = appInfo.executable;
		if ( appInfo.platform === 'win32' ) {
			executablePath = executablePath.replace( 'Squirrel.exe', 'Studio.exe' );
		}

		this.electronApp = await electron.launch( {
			args: [ appInfo.main ],
			executablePath,
			env: {
				...process.env,
				E2E: 'true',
				E2E_APP_DATA_PATH: this.appDataPath,
				E2E_HOME_PATH: this.homePath,
			},
			timeout: 60_000,
		} );
		this.mainWindow = await this.electronApp.firstWindow( { timeout: 60_000 } );
	}

	async cleanup() {
		await this.electronApp?.close();

		// Attempt cleanup with retry logic to handle Windows file locking
		let lastError: Error | null = null;
		for ( let attempt = 0; attempt < 3; attempt++ ) {
			try {
				this.removeDirectoryRecursive( this.sessionPath );
				console.log( '[E2E Cleanup] Successfully cleaned up session directory' );
				return;
			} catch ( error ) {
				lastError = error as Error;
				console.warn(
					`[E2E Cleanup] Attempt ${ attempt + 1 } failed. Retrying in 1s...`,
					lastError.message
				);
				// Wait before retrying
				await new Promise( ( resolve ) => setTimeout( resolve, 1000 ) );
			}
		}

		// Log detailed error information for diagnostics
		console.error( '[E2E Cleanup] Failed to clean up session after 3 attempts' );
		throw new Error(
			`[E2E Cleanup] Failed to clean up session directory: ${ lastError?.message }`
		);
	}

	private removeDirectoryRecursive( dirPath: string ): void {
		if ( ! fsSync.existsSync( dirPath ) ) {
			return;
		}

		let items: string[];
		try {
			items = fsSync.readdirSync( dirPath );
		} catch ( error ) {
			console.error( `[E2E Cleanup] Failed to read directory ${ dirPath }:`, error );
			throw error;
		}

		// Remove each item individually to isolate failures
		for ( const item of items ) {
			const itemPath = path.join( dirPath, item );
			try {
				const stat = fsSync.lstatSync( itemPath ); // Use lstatSync to handle symlinks
				if ( stat.isDirectory() ) {
					this.removeDirectoryRecursive( itemPath );
				} else {
					fsSync.unlinkSync( itemPath );
				}
			} catch ( error ) {
				console.error( `[E2E Cleanup] Failed to remove ${ itemPath }:`, error );
				throw error;
			}
		}

		// Remove the now-empty directory
		try {
			fsSync.rmdirSync( dirPath );
		} catch ( error ) {
			console.error( `[E2E Cleanup] Failed to remove directory ${ dirPath }:`, error );
			throw error;
		}
	}
}
