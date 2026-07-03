import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import path from 'path';
import { findLatestBuild, parseElectronApp } from 'electron-playwright-helpers';
import fs from 'fs-extra';
import { _electron as electron, Page, ElectronApplication } from 'playwright';
import { rimraf } from 'rimraf';
import type { TestInfo } from '@playwright/test';
import type { ChildProcess } from 'node:child_process';

/**
 * The CLI process-manager daemon is machine-global (fixed named pipe on Windows, ~/.studio/daemon
 * socket elsewhere) and spawned detached, so it outlives the app. When `site stop --all` fails on
 * quit, the daemon keeps that session's WordPress servers running; they accumulate across test
 * sessions until the daemon's site capacity is exhausted (36/36) and every subsequent createSite
 * fails. Leaked php.exe processes also hold DLL locks that break session dir cleanup on Windows.
 * Reap the daemon tree after each session so the next one starts from a clean slate.
 *
 * Note: this also kills the daemon of any locally running Studio app — acceptable for e2e runs,
 * which already share the global daemon with it.
 */
function killLeakedDaemonProcesses() {
	try {
		if ( process.platform === 'win32' ) {
			// `-ne $PID` excludes this PowerShell process itself, whose own command line
			// also contains the match string.
			execSync(
				'powershell -NoProfile -Command "Get-CimInstance Win32_Process | ' +
					"Where-Object { $_.CommandLine -match 'process-manager-daemon' -and $_.ProcessId -ne $PID } | " +
					'ForEach-Object { taskkill /F /T /PID $_.ProcessId }"',
				{ stdio: 'ignore' }
			);
		} else {
			// SIGTERM lets the daemon run its graceful shutdown, which stops its site children.
			execSync( 'pkill -f process-manager-daemon', { stdio: 'ignore' } );
		}
	} catch {
		// No daemon running (pkill exits 1 when nothing matches) — nothing to reap.
	}
}

export class E2ESession {
	electronApp!: ElectronApplication;
	mainWindow!: Page;

	sessionPath: string;
	appDataPath: string;
	homePath: string;
	cliConfigPath: string;
	sharedConfigPath: string;
	daemonHome: string;
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
		// DIAGNOSTIC (temporary): put the process-manager daemon — and its per-process stdout/stderr
		// logs — under test-results/daemon-logs so they upload as CI artifacts. This surfaces why
		// native PHP fails to serve on Windows CI (the php.exe error currently goes to ~/.studio and
		// is never uploaded). Relies on the Windows pipe-isolation fix so each session gets its own
		// daemon. Revert once diagnosed.
		this.daemonHome = path.join(
			process.cwd(),
			'test-results',
			'daemon-logs',
			randomUUID().slice( 0, 8 )
		);
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
		if ( ! this.electronApp ) {
			// Launch failed or never happened; nothing to close, and touching
			// `electronApp.process()` would throw and abort the rest of cleanup.
			return;
		}
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
		killLeakedDaemonProcesses();
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
				// DIAGNOSTIC (temporary, Windows only): route the daemon + its logs into the uploaded
				// artifacts dir. Windows-only because the pipe-isolation fix hashes the home into a short
				// pipe name; a Unix socket under this long path would exceed sun_path's ~108-char limit.
				...( process.platform === 'win32' ? { STUDIO_PROCESS_MANAGER_HOME: this.daemonHome } : {} ),
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

		// DIAGNOSTIC (temporary, Windows only): dump the detached daemon's per-site error logs into the
		// live Playwright job log. The daemon writes php.exe's [PHP-DIAG] exit code + stderr to files
		// under daemonHome/logs; streaming them here lets us read the real native-PHP failure from the
		// CI log even when the post-suite runner hang prevents the daemon-logs artifact from uploading.
		if ( process.platform === 'win32' ) {
			this.reportDaemonLogsOnFailure();
		}
	}

	private reportDaemonLogsOnFailure() {
		const logsDir = path.join( this.daemonHome, 'logs' );
		let files: string[];
		try {
			files = fs.readdirSync( logsDir );
		} catch {
			console.error( `[DAEMON-DIAG] no daemon logs directory at ${ logsDir }` );
			return;
		}

		const errorLogs = files.filter( ( file ) => /-error(?:-\d{8})?\.log$/.test( file ) );
		if ( errorLogs.length === 0 ) {
			console.error(
				`[DAEMON-DIAG] no daemon error logs in ${ logsDir } (found: ${
					files.join( ', ' ) || 'none'
				})`
			);
			return;
		}

		for ( const file of errorLogs ) {
			try {
				const contents = fs.readFileSync( path.join( logsDir, file ), 'utf8' ).trim();
				console.error(
					`[DAEMON-DIAG] ${ file }:\n${ contents || '(empty)' }\n[DAEMON-DIAG] end ${ file }`
				);
			} catch ( err ) {
				console.error( `[DAEMON-DIAG] could not read ${ file }: ${ ( err as Error ).message }` );
			}
		}
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
