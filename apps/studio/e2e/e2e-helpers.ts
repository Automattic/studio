import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import path from 'path';
import { expect, type TestInfo } from '@playwright/test';
import { findLatestBuild, parseElectronApp } from 'electron-playwright-helpers';
import fs from 'fs-extra';
import { _electron as electron, Page, ElectronApplication } from 'playwright';
import { rimraf } from 'rimraf';
import AddSite, { type CreateSiteOptions } from './page-objects/add-site';
import Sidebar from './page-objects/sidebar';
import type { ChildProcess } from 'node:child_process';

// `ORIENTATION_GUIDE_VERSION` in apps/ui/src/data/onboarding/orientation-guide.ts.
const ORIENTATION_GUIDE_VERSION = 2;

export type PersistedSite = { id: string; name: string; path: string; port: number };

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

	/**
	 * `firstRun` launches like a fresh install, on the welcome screen. Otherwise the run starts past
	 * onboarding and the orientation guide, with AI features off so a signed-out site opens on its
	 * overview rather than on a sign-in prompt.
	 */
	async launch( testEnv: NodeJS.ProcessEnv = {}, { firstRun = false } = {} ) {
		await fs.mkdir( this.appDataPath, { recursive: true } );
		await fs.mkdir( this.homePath, { recursive: true } );
		await fs.mkdir( this.cliConfigPath, { recursive: true } );
		await fs.mkdir( this.sharedConfigPath, { recursive: true } );

		// Path must include 'Studio' subfolder to match Electron app's path structure
		const studioAppDataPath = path.join( this.appDataPath, 'Studio' );
		await fs.mkdir( studioAppDataPath, { recursive: true } );

		const initialAppdata = {
			version: 1,
			sites: [],
			snapshots: [],
			betaFeatures: { studioSitesCli: true },
			...( firstRun
				? {}
				: {
						onboardingCompleted: true,
						onboardingHints: { tourDismissedVersion: ORIENTATION_GUIDE_VERSION },
						agenticFeaturesEnabled: false,
				  } ),
		};

		await fs.writeFile(
			path.join( studioAppDataPath, 'appdata-v1.json' ),
			JSON.stringify( initialAppdata, null, 2 )
		);

		await this.launchFirstWindow( testEnv );
	}

	/**
	 * Stub native message boxes to auto-answer with the given response index,
	 * recording each dialog's text for `getRecordedDialogs`.
	 */
	async stubMessageBox( response = 0 ) {
		await this.electronApp.evaluate( ( { dialog }, autoResponse ) => {
			const dialogGlobal = globalThis as typeof globalThis & { __e2eDialogs: string[] };
			dialogGlobal.__e2eDialogs = [];
			dialog.showMessageBox = ( async ( ...args: unknown[] ) => {
				// Options are the last arg: showMessageBox( [parentWindow,] options ).
				const options = ( args.length > 1 ? args[ 1 ] : args[ 0 ] ) as {
					title?: string;
					message?: string;
					detail?: string;
				};
				dialogGlobal.__e2eDialogs.push(
					[ options?.title, options?.message, options?.detail ].filter( Boolean ).join( ' — ' )
				);
				return { response: autoResponse, checkboxChecked: false };
			} ) as typeof dialog.showMessageBox;
		}, response );
	}

	/** Dialog texts recorded by the `stubMessageBox` stub, oldest first. */
	async getRecordedDialogs(): Promise< string[] > {
		return this.electronApp.evaluate(
			() => ( globalThis as typeof globalThis & { __e2eDialogs?: string[] } ).__e2eDialogs ?? []
		);
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

	async getSites(): Promise< PersistedSite[] > {
		const config = await fs
			.readJson( path.join( this.cliConfigPath, 'cli.json' ) )
			.catch( () => ( { sites: [] } ) );
		return config.sites;
	}

	// Polls cli.json, which the CLI may write slightly after the UI shows the site.
	async waitForSite( siteName: string ): Promise< PersistedSite > {
		let site: PersistedSite | undefined;
		await expect
			.poll(
				async () => {
					site = ( await this.getSites() ).find( ( candidate ) => candidate.name === siteName );
					return site?.port;
				},
				{ message: `site "${ siteName }" was never persisted to cli.json`, timeout: 120_000 }
			)
			.toBeTruthy();
		return site as PersistedSite;
	}

	async getSiteUrl( siteName: string ) {
		const { port } = await this.waitForSite( siteName );
		return `http://localhost:${ port }`;
	}

	async restart( testEnv: NodeJS.ProcessEnv = {} ) {
		await this.closeApp();
		await this.launchFirstWindow( testEnv );
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

/**
 * Launches Studio and creates a site through "Add a site", resolving once it runs. `folder` makes
 * the mocked folder dialog return `~/Studio/<folder>`, and has the form pick it.
 */
export async function launchWithSite(
	session: E2ESession,
	{ folder, ...options }: Omit< CreateSiteOptions, 'pickFolder' > & { folder?: string } = {}
) {
	const env: NodeJS.ProcessEnv = {};
	if ( folder ) {
		env.E2E_OPEN_FOLDER_DIALOG = path.join( session.homePath, 'Studio', folder );
		await fs.mkdir( env.E2E_OPEN_FOLDER_DIALOG, { recursive: true } );
	}
	await session.launch( env );
	const siteName = await new AddSite( session.mainWindow ).createSite( {
		...options,
		pickFolder: Boolean( folder ),
	} );
	await new Sidebar( session.mainWindow ).expectRunning( siteName );
	return { siteName, site: await session.waitForSite( siteName ) };
}
