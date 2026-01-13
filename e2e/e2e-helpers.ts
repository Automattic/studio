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

		const initialAppdata = {
			version: 1,
			sites: [],
			snapshots: [],
			betaFeatures: {
				studioSitesCli: true,
			},
		};

		await fs.writeFile(
			path.join( studioAppDataPath, 'appdata-v1.json' ),
			JSON.stringify( initialAppdata, null, 2 )
		);

		await this.launchFirstWindow( testEnv );
	}

	async closeApp() {
		console.log( 'Closing app...' );
		const childProcess = this.electronApp.process();

		// Playwright's electronApp.close() can hang, especially on Windows. This is likely due to how
		// `stopAllServersOnQuit` spawns a child process in the `will-quit` event handler, sidestepping
		// Electron's normal close sequence.
		const exitPromise = new Promise< void >( ( resolve ) => {
			childProcess.once( 'exit', resolve );
		} );
		const timeoutPromise = new Promise< void >( ( _, reject ) => {
			setTimeout( () => reject( new Error( 'Process exit timeout' ) ), 30_000 );
		} );

		await this.electronApp.evaluate( ( { app } ) => app.quit() ).catch( () => {} );

		try {
			await Promise.race( [ exitPromise, timeoutPromise ] );
			console.log( 'App closed successfully' );
		} catch ( error ) {
			console.log( 'Process exit timeout' );
		}
	}

	async restart() {
		await this.closeApp();
		await this.launchFirstWindow();
	}

	async cleanup() {
		await this.closeApp();

		fs.rmSync( this.sessionPath, {
			force: true,
			maxRetries: 5,
			recursive: true,
			retryDelay: 500,
		} );
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
}
