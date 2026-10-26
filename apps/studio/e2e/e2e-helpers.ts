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

// `ORIENTATION_GUIDE_VERSION` in apps/ui/src/features/onboarding/onboarding-guide/orientation-guide.ts.
const ORIENTATION_GUIDE_VERSION = 2;

export type PersistedSite = { id: string; name: string; path: string; port: number };

export type LaunchOptions = {
	firstRun?: boolean;
	// Merged into the initial app data, e.g. `{ onboardingCompleted: false }`.
	appData?: Record< string, unknown >;
	// Merged into shared.json, e.g. an AI provider and its key.
	sharedConfig?: Record< string, unknown >;
};

export class E2ESession {
	electronApp!: ElectronApplication;
	mainWindow!: Page;

	sessionPath: string;
	appDataPath: string;
	homePath: string;
	cliConfigPath: string;
	sharedConfigPath: string;
	userDataPath: string;
	daemonHomePath: string;
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
		// Electron keys its single-instance lock to the user data directory.
		this.userDataPath = path.join( this.sessionPath, 'userData' );
		// Each session runs its own process-manager daemon: quitting the app stops the daemon and
		// every site it runs, which must not reach another worker's sites. Kept short and directly
		// under tmpdir because the daemon's Unix socket path is limited to ~104 characters on macOS.
		this.daemonHomePath = path.join( tmpdir(), `sd-${ randomUUID().slice( 0, 8 ) }` );
	}

	/**
	 * `firstRun` launches like a fresh install, on the welcome screen. Otherwise the run starts past
	 * onboarding and the orientation guide.
	 */
	async launch(
		testEnv: NodeJS.ProcessEnv = {},
		{ firstRun = false, appData, sharedConfig }: LaunchOptions = {}
	) {
		await fs.mkdir( this.appDataPath, { recursive: true } );
		await fs.mkdir( this.homePath, { recursive: true } );
		await fs.mkdir( this.cliConfigPath, { recursive: true } );
		await fs.mkdir( this.sharedConfigPath, { recursive: true } );
		await fs.mkdir( this.daemonHomePath, { recursive: true } );

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
						// What's New is never due, whatever its version.
						onboardingHints: {
							tourDismissedVersion: ORIENTATION_GUIDE_VERSION,
							whatsNewSeenVersion: Number.MAX_SAFE_INTEGER,
						},
				  } ),
			...appData,
		};

		await fs.writeFile(
			path.join( studioAppDataPath, 'appdata-v1.json' ),
			JSON.stringify( initialAppdata, null, 2 )
		);
		// On macOS the app's AppleLanguages default is shared by every session, and the app falls back
		// to it without a saved locale, so a language another worker picks would leak in.
		await fs.writeJson( path.join( this.sharedConfigPath, 'shared.json' ), {
			version: 1,
			locale: 'en',
			...sharedConfig,
		} );

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

	async getAppConfig(): Promise< Record< string, unknown > > {
		return fs.readJson( path.join( this.sharedConfigPath, 'app.json' ) );
	}

	// The text of the page the site preview shows.
	async previewText(): Promise< string | undefined > {
		const guestId = await this.mainWindow
			.locator( 'webview' )
			.evaluate( ( element ) =>
				( element as HTMLElement & { getWebContentsId: () => number } ).getWebContentsId()
			);
		return this.electronApp.evaluate(
			( { webContents }, id ) =>
				webContents.fromId( id )?.executeJavaScript( 'document.body.innerText' ),
			guestId
		);
	}

	async getSiteUrl( siteName: string ) {
		const { port } = await this.waitForSite( siteName );
		return `http://localhost:${ port }`;
	}

	async restart( testEnv: NodeJS.ProcessEnv = {} ) {
		await this.closeApp();
		await this.launchFirstWindow( testEnv );
	}

	async stopAllSites() {
		await this.mainWindow.evaluate( async () => {
			const sites = await window.ipcApi.getSiteDetails();
			await Promise.all(
				sites
					.filter( ( site ) => site.running )
					.map( ( site ) => window.ipcApi.stopServer( site.id ) )
			);
		} );
	}

	async cleanup() {
		await this.closeApp();
		// CI sets this to upload each session's daemon and site logs when a run fails.
		const keptLogsDir = process.env.STUDIO_E2E_DAEMON_LOGS_DIR;
		const daemonLogsDir = path.join( this.daemonHomePath, 'logs' );
		if ( keptLogsDir && fs.existsSync( daemonLogsDir ) ) {
			await fs
				.copy( daemonLogsDir, path.resolve( keptLogsDir, path.basename( this.daemonHomePath ) ) )
				.catch( () => {
					// Best effort: missing diagnostics must not fail the test.
				} );
		}
		await rimraf( [ this.sessionPath, this.daemonHomePath ], {
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
			args: [ ...linuxFlags, `--user-data-dir=${ this.userDataPath }`, appInfo.main ],
			executablePath,
			env: {
				...process.env,
				...testEnv,
				E2E: 'true',
				E2E_APP_DATA_PATH: this.appDataPath,
				E2E_HOME_PATH: this.homePath,
				E2E_CLI_CONFIG_PATH: this.cliConfigPath,
				E2E_SHARED_CONFIG_PATH: this.sharedConfigPath,
				STUDIO_PROCESS_MANAGER_HOME: this.daemonHomePath,
				// Workers run concurrently, so each assigns site ports from its own range.
				STUDIO_BASE_PORT: String( 8881 + Number( process.env.TEST_PARALLEL_INDEX ?? 0 ) * 1000 ),
			},
			timeout: 60_000,
		} );

		this.startCapturingMainProcessLogs();
		// Playwright's `trace` option only records browsers it launches itself, so the app's window
		// is recorded here. `reportFailure` keeps the recording of each failed test.
		await this.electronApp.context().tracing.start( { snapshots: true } );

		this.mainWindow = await this.electronApp.firstWindow( { timeout: 60_000 } );
	}

	// Attaches the app window's trace and the main process logs to a failed test. Every test starts
	// a new trace chunk, so a failure's trace covers that test (or, for the first test, the launch
	// before it too).
	async reportFailure( testInfo: TestInfo ) {
		const tracing = this.electronApp.context().tracing;
		if ( testInfo.status === testInfo.expectedStatus ) {
			await tracing.stopChunk().catch( () => {} );
			await tracing.startChunk().catch( () => {} );
			return;
		}

		const tracePath = testInfo.outputPath( 'app-trace.zip' );
		await tracing
			.stopChunk( { path: tracePath } )
			.then( () =>
				testInfo.attach( 'app-trace', { path: tracePath, contentType: 'application/zip' } )
			)
			.catch( () => {
				// Best effort: missing diagnostics must not fail the test.
			} );
		await tracing.startChunk().catch( () => {} );

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
 * Launches Studio and creates a site through Add site, resolving once it runs. `folder` makes
 * the mocked folder dialog return `~/Studio/<folder>`, and has the form pick it.
 */
export async function launchWithSite(
	session: E2ESession,
	{ folder, ...options }: Omit< CreateSiteOptions, 'pickFolder' > & { folder?: string } = {},
	launchOptions: LaunchOptions = {}
) {
	const env: NodeJS.ProcessEnv = {};
	if ( folder ) {
		env.E2E_OPEN_FOLDER_DIALOG = path.join( session.homePath, 'Studio', folder );
		await fs.mkdir( env.E2E_OPEN_FOLDER_DIALOG, { recursive: true } );
	}
	await session.launch( env, launchOptions );
	const siteName = await new AddSite( session.mainWindow ).createSite( {
		...options,
		pickFolder: Boolean( folder ),
	} );
	await new Sidebar( session.mainWindow ).expectRunning( siteName );
	return { siteName, site: await session.waitForSite( siteName ) };
}
