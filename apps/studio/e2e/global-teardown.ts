import { execFileSync } from 'node:child_process';

/**
 * The E2E suite drives Studio, which spawns a long-lived CLI process-manager daemon
 * (`resources/cli/process-manager-daemon.mjs`) to run each site's PHP servers. On Windows
 * the daemon is orphaned when the Electron app quits and survives with its
 * `php-server-child.mjs` / `php.exe` subtree; the Playwright runner then holds an open
 * handle to it and never exits, so the CI job hangs to the 180-min timeout (AINFRA-2588).
 * `closeApp()` / `site stop --all` don't reap it. Once the whole suite is done nothing
 * needs the daemon, so kill any survivors here to let the runner exit.
 */
export default function globalTeardown() {
	if ( process.platform === 'win32' ) {
		reapWindowsStudioDaemons();
	} else {
		reapUnixStudioDaemons();
	}
}

function reapWindowsStudioDaemons() {
	const query =
		'Get-CimInstance Win32_Process | ' +
		"Where-Object { $_.CommandLine -match 'process-manager-daemon\\.mjs' } | " +
		'Select-Object -ExpandProperty ProcessId';

	let pids: string[] = [];
	try {
		const out = execFileSync(
			'powershell',
			[ '-NoProfile', '-NonInteractive', '-Command', query ],
			{ encoding: 'utf8' }
		);
		pids = out.split( /\s+/ ).filter( Boolean );
	} catch {
		// No daemon found, or powershell unavailable — nothing to reap.
		return;
	}

	// `taskkill /T` walks the tree, killing the daemon's php-server-child.mjs and php.exe
	// descendants along with it.
	for ( const pid of pids ) {
		try {
			execFileSync( 'taskkill', [ '/F', '/T', '/PID', pid ], { stdio: 'ignore' } );
			console.log( `[global-teardown] killed lingering Studio daemon tree (pid ${ pid })` );
		} catch {
			// Already exited between the query and the kill.
		}
	}
}

function reapUnixStudioDaemons() {
	// macOS/Linux don't exhibit the hang, but reap any lingering daemon by command-line
	// match so a leak can't regress silently. `pkill` exits non-zero when nothing matches.
	try {
		execFileSync( 'pkill', [ '-f', 'process-manager-daemon\\.mjs' ], { stdio: 'ignore' } );
	} catch {
		// Nothing matched — fine.
	}
}
