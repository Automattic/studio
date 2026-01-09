import { ChildProcess, execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { tmpdir, platform } from 'os';
import path from 'path';
import { findLatestBuild, parseElectronApp } from 'electron-playwright-helpers';
import fs from 'fs-extra';
import pidtree from 'pidtree';
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

	async closeApp() {
		console.log( 'Closing app...' );
		const childProcess = this.electronApp.process();
		const pid = childProcess.pid;

		let childPids: number[] = [];
		if ( pid ) {
			try {
				childPids = await pidtree( pid );
				console.log( 'process children before close', childPids );
			} catch {
				// Process may have already exited
			}
		} else {
			console.log( 'No process pid' );
		}

		// On Windows, Playwright's electronApp.close() can hang indefinitely because the 'close'
		// event on the spawned process never fires. This happens when CLI child processes inherit
		// stdio handles from the shell (cmd.exe) that Playwright uses to spawn Electron on Windows.
		// The 'exit' event fires correctly, but 'close' waits for all stdio streams to close,
		// which doesn't happen if inherited handles are held by child processes.
		//
		// Workaround: On Windows, manually trigger app.quit(), wait for the process exit event,
		// then kill any remaining child processes instead of using electronApp.close().
		if ( platform() === 'win32' ) {
			await this.closeAppWindows( childProcess, childPids );
		} else {
			console.log( 'Calling electronApp.close()' );
			await this.electronApp.close();
			console.log( 'electronApp.close() resolved' );
		}

		if ( pid ) {
			try {
				const remainingChildren = await pidtree( pid );
				console.log( 'process children after close', remainingChildren );
			} catch {
				// Expected - parent process should be gone
				console.log( 'Parent process terminated (pidtree found no matching pid)' );
			}
		}
	}

	private async closeAppWindows( childProcess: ChildProcess, childPids: number[] ) {
		console.log( 'Using Windows-specific close workaround' );

		// Create a promise that resolves when the process exits
		const exitPromise = new Promise< void >( ( resolve ) => {
			childProcess.once( 'exit', ( code, signal ) => {
				console.log( `Process exited with code=${ code }, signal=${ signal }` );
				resolve();
			} );
		} );

		// Trigger app.quit() via Playwright's evaluate
		try {
			console.log( 'Evaluating app.quit()' );
			await this.electronApp.evaluate( ( { app } ) => app.quit() );
			console.log( 'app.quit() evaluated' );
		} catch ( error ) {
			// The connection may close before we get a response, which is expected
			console.log( 'app.quit() evaluation completed (connection may have closed)' );
		}

		// Wait for the exit event with a timeout
		console.log( 'Waiting for process exit...' );
		const timeoutPromise = new Promise< void >( ( _, reject ) => {
			setTimeout( () => reject( new Error( 'Process exit timeout' ) ), 30_000 );
		} );

		try {
			await Promise.race( [ exitPromise, timeoutPromise ] );
			console.log( 'Process exit event received' );
		} catch ( error ) {
			console.log( 'Process exit timeout, will force kill' );
		}

		// Kill any remaining child processes
		await this.killRemainingProcesses( childPids );

		console.log( 'Windows close workaround completed' );
	}

	private async killRemainingProcesses( pids: number[] ) {
		for ( const pid of pids ) {
			try {
				// On Windows, use taskkill to forcefully terminate the process
				console.log( `Killing remaining process ${ pid }` );
				execSync( `taskkill /pid ${ pid } /f /t`, { stdio: 'ignore' } );
			} catch {
				// Process may have already exited, ignore errors
			}
		}
	}

	// Close the app but keep the data for persistence testing
	async restart() {
		await this.closeApp();
		await this.launchFirstWindow();
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
