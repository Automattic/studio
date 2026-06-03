import { fork, spawn, type ChildProcess, type StdioOptions } from 'node:child_process';
import {
	getBundledNodeBinaryPath,
	getCliBinaryPath,
	getCliExtractionDir,
	getCliPath,
} from 'src/storage/paths';

interface SpawnCliProcessOptions {
	stdio?: StdioOptions;
	env?: NodeJS.ProcessEnv;
}

/**
 * Spawns the Studio CLI as a child process. Every main-process caller must go
 * through here so the production (bundled binary) and development (system Node)
 * paths can't drift apart.
 */
export function spawnCliProcess(
	args: string[],
	options: SpawnCliProcessOptions = {}
): ChildProcess {
	const cliBinaryPath = getCliBinaryPath();

	if ( cliBinaryPath !== null ) {
		// Production: run the bundled SEA binary directly. STUDIO_CLI_DIR points
		// its first-run asset extraction at a writable per-user dir. We can't pass
		// --experimental-wasm-jspi to a SEA binary — Node's SEA startup skips CLI
		// flag parsing and rejects it via NODE_OPTIONS — so PHP-WASM falls back to
		// asyncify (slower for Redis/memcached, otherwise correct).
		return spawn( cliBinaryPath, args, {
			stdio: options.stdio,
			env: {
				...process.env,
				...options.env,
				STUDIO_CLI_DIR: getCliExtractionDir(),
			},
		} );
	}

	// Development/test: fork the CLI script with the system/Electron Node binary.
	return fork( getCliPath(), args, {
		stdio: options.stdio,
		execPath: getBundledNodeBinaryPath(),
		execArgv: [ '--experimental-wasm-jspi' ],
		env: { ...process.env, ...options.env },
	} );
}
