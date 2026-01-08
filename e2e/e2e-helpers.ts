import { randomUUID } from 'crypto';
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

		await this.launchFirstWindow( testEnv );
	}

	// Close the app but keep the data for persistence testing
	async restart() {
		await this.closeApp();
		await this.launchFirstWindow();
	}

	private async closeApp() {
		console.log( 'closeApp: starting' );
		if ( ! this.electronApp ) {
			console.log( 'closeApp: no electronApp' );
			return;
		}

		const childProcess = this.electronApp.process();
		console.log( 'closeApp: closing pid', childProcess.pid );

		// On Windows, Playwright's close() hangs indefinitely even though the process
		// exits. This appears to be related to debugger/WebSocket cleanup issues.
		// We bypass close() entirely and kill the process directly.
		if ( process.platform === 'win32' ) {
			childProcess.kill();

			// Wait for process to exit
			if ( childProcess.exitCode === null ) {
				await new Promise< void >( ( resolve ) => {
					childProcess.on( 'exit', () => {
						console.log( 'closeApp: process exited' );
						resolve();
					} );
				} );
			}
		} else {
			await this.electronApp.close();
			console.log( 'closeApp: close() returned' );

			// Ensure process is fully dead (singleton lock released) before continuing.
			// This prevents a race condition where the next test launches before the
			// previous instance has fully exited and released the singleton lock.
			if ( childProcess.exitCode === null ) {
				await new Promise< void >( ( resolve ) =>
					childProcess.on( 'exit', () => {
						console.log( 'closeApp: process exited' );
						resolve();
					} )
				);
			}
		}

		// Clear the reference so Playwright doesn't try to close it again during teardown
		this.electronApp = null as unknown as ElectronApplication;
		console.log( 'closeApp: done' );
	}

	private async launchFirstWindow( testEnv: NodeJS.ProcessEnv = {} ) {
		const latestBuild = findLatestBuild();
		const appInfo = parseElectronApp( latestBuild );
		let executablePath = appInfo.executable;
		if ( appInfo.platform === 'win32' ) {
			// `parseElectronApp` function obtains the executable path by finding the first executable from
			// the build folder. We need to ensure that the executable is the Studio app.
			executablePath = executablePath.replace( 'Squirrel.exe', 'Studio.exe' );
		}

		this.electronApp = await electron.launch( {
			args: [ appInfo.main ],
			executablePath,
			env: {
				...process.env,
				...testEnv,
				E2E: 'true',
				E2E_APP_DATA_PATH: this.appDataPath,
				E2E_HOME_PATH: this.homePath,
			},
			timeout: 60_000,
		} );
		this.mainWindow = await this.electronApp.firstWindow( { timeout: 60_000 } );
	}

	async cleanup() {
		await this.closeApp();

		// Removing the `sessionPath` directory has proven to be difficult, especially on Windows. Since
		// session paths are unique, the WordPress installations are relatively small, and the E2E tests
		// primarily run in ephemeral CI workers, we've decided to fix this issue by simply not removing
		// the `sessionPath` directory.
	}
}
