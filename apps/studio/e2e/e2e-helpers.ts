import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import path from 'path';
import { findLatestBuild, parseElectronApp } from 'electron-playwright-helpers';
import fs from 'fs-extra';
import { _electron as electron, Page, ElectronApplication } from 'playwright';
import { rimraf } from 'rimraf';
import type { TestInfo } from '@playwright/test';
import type { ChildProcess } from 'node:child_process';

export class E2ESession {
	electronApp!: ElectronApplication;
	mainWindow!: Page;

	sessionPath: string;
	appDataPath: string;
	homePath: string;
	cliConfigPath: string;
	sharedConfigPath: string;
	private mainProcessLogs: string[] = [];
	private readonly maxMainProcessLogChunks = 500;
	private stdoutListener?: ( chunk: Buffer | string ) => void;
	private stderrListener?: ( chunk: Buffer | string ) => void;
	private childProcess?: ChildProcess;

	public constructor() {
		this.sessionPath = path.join( tmpdir(), `studio-app-e2e-session-${ randomUUID() }` );
		this.appDataPath = path.join( this.sessionPath, 'appData' );
		this.homePath = path.join( this.sessionPath, 'home' );
		this.cliConfigPath = path.join( this.sessionPath, 'cliConfig' );
		this.sharedConfigPath = path.join( this.sessionPath, 'sharedConfig' );
	}

	async launch( testEnv: NodeJS.ProcessEnv = {} ) {
		await fs.mkdir( this.appDataPath, { recursive: true } );
		await fs.mkdir( this.homePath, { recursive: true } );
		await fs.mkdir( this.cliConfigPath, { recursive: true } );
		await fs.mkdir( this.sharedConfigPath, { recursive: true } );

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
			await new Promise< void >( ( resolve ) => setTimeout( resolve, 2000 ) );
			console.log( 'App closed successfully' );
		} catch ( error ) {
			console.log( 'Process exit timeout' );
		} finally {
			this.stopCapturingMainProcessLogs();
		}
	}

	async restart() {
		await this.closeApp();
		await this.launchFirstWindow();
	}

	async cleanup() {
		await this.closeApp();
		await rimraf( this.sessionPath, {
			backoff: 2,
			maxBackoff: 2500,
			maxRetries: 50,
		} );
	}

	private async launchFirstWindow( testEnv: NodeJS.ProcessEnv = {} ) {
		const buildDir = path.join( __dirname, '..', 'out' );
		const latestBuild = findLatestBuild( buildDir );
		const appInfo = parseElectronApp( latestBuild );
		let executablePath = appInfo.executable;

		if ( appInfo.platform === 'win32' ) {
			// `parseElectronApp` function obtains the executable path by finding the first executable from
			// the build folder. We need to ensure that the executable is the Studio app.
			executablePath = executablePath.replace( 'Squirrel.exe', 'Studio.exe' );
		}

		// Linux E2E runs as a non-root user inside a Docker container with
		// chrome-sandbox removed and no SYS_ADMIN capability, so neither the
		// SUID sandbox nor the user-namespace sandbox can initialize. Without
		// --no-sandbox Chromium aborts with "No usable sandbox!" before any
		// window is created. Playwright auto-adds this flag only when the
		// launching user is root, so we add it explicitly here.
		//
		// --disable-gpu + --use-gl=swiftshader force CPU-based software
		// rendering. xvfb has no real GPU, and Chromium's default fallback
		// path in containers can leave the compositor hung — the renderer
		// populates the DOM but no frames are painted, so Playwright sees
		// elements that are technically present but never become "visible".
		// SwiftShader is the deterministic software GL driver Chromium ships
		// for exactly this case.
		//
		// --disable-dev-shm-usage avoids Docker's small default /dev/shm
		// mount. The Linux Buildkite step is already headless, so using /tmp
		// for Chromium shared memory is a better tradeoff than intermittent
		// renderer or helper-process instability under load.
		const linuxFlags =
			appInfo.platform === 'linux'
				? [
						'--no-sandbox',
						'--disable-gpu',
						'--use-gl=swiftshader',
						'--disable-dev-shm-usage',
						'--host-resolver-rules=MAP localhost 127.0.0.1',
				  ]
				: [];

		this.electronApp = await electron.launch( {
			args: [ ...linuxFlags, appInfo.main ],
			executablePath,
			env: {
				...process.env,
				...testEnv,
				E2E: 'true',
				E2E_APP_DATA_PATH: this.appDataPath,
				E2E_HOME_PATH: this.homePath,
				E2E_CLI_CONFIG_PATH: this.cliConfigPath,
				E2E_SHARED_CONFIG_PATH: this.sharedConfigPath,
			},
			timeout: 60_000,
		} );

		this.startCapturingMainProcessLogs();

		this.mainWindow = await this.electronApp.firstWindow( { timeout: 60_000 } );
	}

	async reportMainProcessLogsOnFailure( testInfo: TestInfo ) {
		if ( testInfo.status === testInfo.expectedStatus ) {
			return;
		}

		const logs =
			this.getMainProcessLogs() || 'No main process logs were captured before the failure.';
		const report = [ `Main process logs for failed test: ${ testInfo.title }`, '', logs ].join(
			'\n'
		);

		console.error( report );
		await testInfo.attach( 'main-process.log', {
			body: Buffer.from( report, 'utf8' ),
			contentType: 'text/plain',
		} );
	}

	private startCapturingMainProcessLogs() {
		this.stopCapturingMainProcessLogs();
		this.mainProcessLogs = [];
		this.childProcess = this.electronApp.process();

		this.stdoutListener = ( chunk ) => {
			this.appendMainProcessLogChunk( chunk );
		};
		this.stderrListener = ( chunk ) => {
			this.appendMainProcessLogChunk( chunk );
		};

		this.childProcess.stdout?.on( 'data', this.stdoutListener );
		this.childProcess.stderr?.on( 'data', this.stderrListener );
	}

	private stopCapturingMainProcessLogs() {
		if ( this.stdoutListener ) {
			this.childProcess?.stdout?.off( 'data', this.stdoutListener );
		}

		if ( this.stderrListener ) {
			this.childProcess?.stderr?.off( 'data', this.stderrListener );
		}

		this.stdoutListener = undefined;
		this.stderrListener = undefined;
		this.childProcess = undefined;
	}

	private appendMainProcessLogChunk( chunk: Buffer | string ) {
		const text = chunk.toString();
		this.mainProcessLogs.push( text );

		while ( this.mainProcessLogs.length > this.maxMainProcessLogChunks ) {
			this.mainProcessLogs.shift();
		}
	}

	private getMainProcessLogs() {
		return this.mainProcessLogs.join( '' ).trim();
	}
}
