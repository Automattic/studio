/**
 * Supervises the frontend half of a headless site through the process-manager
 * daemon, the way `wordpress-server-manager.ts` supervises WordPress.
 *
 * Contract shared between the CLI commands (create, start, stop, status) and
 * the implementation in `frontend-server-child.ts`. The functions here are the
 * only way the rest of the CLI starts, stops or inspects a frontend.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { readLastLines } from '@studio/common/lib/fs-utils';
import {
	buildFrontendEnv,
	FRONTEND_ENV,
	getFrontendUrl,
	type SiteFrontend,
} from '@studio/common/lib/site-frontend';
import { __, sprintf } from '@wordpress/i18n';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import {
	connectToDaemon,
	isProcessRunning,
	startProcess,
	stopProcess,
} from 'cli/lib/daemon-client';
import {
	buildFrontendChildEnv,
	FRONTEND_READY_TIMEOUT_MS,
	getServedDirectory,
} from 'cli/lib/frontend/child-config';
import { readDotenvFile } from 'cli/lib/frontend/dotenv';
import { getFrontendEnvPath } from 'cli/lib/frontend/provision';
import {
	buildShellInvocation,
	getNodeDetectionScript,
	getNodeMajorVersion,
	parseNodeDetectionOutput,
} from 'cli/lib/frontend/shell';
import { findLatestProcessLogPaths } from 'cli/lib/process-logs';
import { subscribeForReadyOrExit } from 'cli/lib/wordpress-server-manager';
import { LoggerError } from 'cli/logger';
import type { HeadlessSite } from 'cli/lib/cli-config/core';
import type { ProcessDescription } from 'cli/lib/types/process-manager-ipc';
import type { Logger } from 'cli/logger';

const FRONTEND_PROCESS_PREFIX = 'studio-frontend-';

export function getFrontendProcessName( siteId: string ): string {
	return `${ FRONTEND_PROCESS_PREFIX }${ siteId }`;
}

export type { HeadlessSite };

export interface NodeRuntime {
	// Absolute path to the `node` binary resolved through the user's login shell.
	nodePath: string;
	version: string;
	npmPath?: string;
}

export const MIN_FRONTEND_NODE_MAJOR = 20;

const FRONTEND_CHILD_PATH = path.resolve( import.meta.dirname, 'frontend-server-child.mjs' );
const NODE_PROBE_TIMEOUT_MS = 15_000;
// The child gives up on its own after FRONTEND_READY_TIMEOUT_MS; this only
// covers a child that hangs without exiting.
const READY_WAIT_MARGIN_MS = 15_000;

function runShellProbe( command: string, interactive: boolean ): Promise< string > {
	const invocation = buildShellInvocation( command, { interactive } );
	return new Promise( ( resolve ) => {
		let stdout = '';
		let settled = false;
		// `detached` gives the probe its own session, so an interactive shell
		// can't take over the terminal the CLI runs in.
		const child = spawn( invocation.file, invocation.args, {
			stdio: [ 'ignore', 'pipe', 'ignore' ],
			detached: process.platform !== 'win32',
			windowsHide: true,
			windowsVerbatimArguments: invocation.windowsVerbatimArguments,
		} );
		const finish = () => {
			if ( ! settled ) {
				settled = true;
				clearTimeout( timeout );
				resolve( stdout );
			}
		};
		const timeout = setTimeout( () => {
			try {
				if ( child.pid && process.platform !== 'win32' ) {
					process.kill( -child.pid, 'SIGKILL' );
				} else {
					child.kill( 'SIGKILL' );
				}
			} catch {
				// Already gone.
			}
			finish();
		}, NODE_PROBE_TIMEOUT_MS );
		child.stdout?.on( 'data', ( chunk: Buffer ) => {
			stdout += chunk.toString();
		} );
		child.once( 'error', finish );
		child.once( 'close', finish );
	} );
}

async function probeNodeRuntime(): Promise< NodeRuntime | undefined > {
	const script = getNodeDetectionScript();
	// The interactive shell also loads `.zshrc`/`.bashrc`, where nvm usually lives.
	const attempts = process.platform === 'win32' ? [ false ] : [ true, false ];
	for ( const interactive of attempts ) {
		const detected = parseNodeDetectionOutput( await runShellProbe( script, interactive ) );
		if ( detected ) {
			return detected;
		}
	}
	return undefined;
}

let nodeRuntimePromise: Promise< NodeRuntime | undefined > | undefined;

/**
 * Finds a Node.js runtime the way the user's terminal would (nvm, volta, fnm,
 * Homebrew, system). Returns undefined when none is found; the static frontend
 * kind needs none.
 */
export async function detectNodeRuntime(): Promise< NodeRuntime | undefined > {
	nodeRuntimePromise ??= probeNodeRuntime();
	return nodeRuntimePromise;
}

export function resetNodeRuntimeCache(): void {
	nodeRuntimePromise = undefined;
}

// The Node.js the frontend's commands run with, or a LoggerError saying how to
// get one. Shared by the dev server start and the template's dependency install.
export async function requireNodeRuntime( devCommand: string ): Promise< NodeRuntime > {
	const runtime = await detectNodeRuntime();
	if ( ! runtime ) {
		throw new LoggerError(
			sprintf(
				// translators: 1: minimum Node.js major version, 2: the frontend's dev command.
				__(
					'Node.js %1$d or later is required to run this site’s frontend (`%2$s`), but none was found. Install it from https://nodejs.org (or with nvm, Volta, fnm or Homebrew), open a new terminal so it is on your PATH, then start the site again.'
				),
				MIN_FRONTEND_NODE_MAJOR,
				devCommand
			)
		);
	}
	const major = getNodeMajorVersion( runtime.version );
	if ( major !== undefined && major < MIN_FRONTEND_NODE_MAJOR ) {
		throw new LoggerError(
			sprintf(
				// translators: 1: minimum Node.js major version, 2: detected Node.js version, 3: path to node.
				__(
					'Node.js %1$d or later is required to run this site’s frontend, but %2$s was found at %3$s. Install a newer version from https://nodejs.org (or with nvm, Volta, fnm or Homebrew), then start the site again.'
				),
				MIN_FRONTEND_NODE_MAJOR,
				runtime.version,
				runtime.nodePath
			)
		);
	}
	return runtime;
}

/**
 * The env contract (`buildFrontendEnv`) for a headless site. The application
 * password is read back from the frontend's `.env.local`, where create wrote it.
 */
export function getFrontendEnv( site: HeadlessSite ): Record< string, string > {
	const dotenv = readDotenvFile( getFrontendEnvPath( site.frontend ) );
	return buildFrontendEnv( {
		siteUrl: getSiteUrl( site ),
		frontend: site.frontend,
		applicationUser: dotenv[ FRONTEND_ENV.WORDPRESS_APPLICATION_USER ],
		applicationPassword: dotenv[ FRONTEND_ENV.WORDPRESS_APPLICATION_PASSWORD ],
	} );
}

function assertFrontendRunnable( frontend: SiteFrontend ): void {
	if ( ! fs.statSync( frontend.path, { throwIfNoEntry: false } )?.isDirectory() ) {
		throw new LoggerError(
			sprintf(
				// translators: %s: path of the frontend project folder.
				__( 'The frontend folder %s does not exist.' ),
				frontend.path
			)
		);
	}
	if ( frontend.kind === 'static' ) {
		const servedDir = getServedDirectory( frontend );
		if ( ! fs.statSync( servedDir, { throwIfNoEntry: false } )?.isDirectory() ) {
			throw new LoggerError(
				sprintf(
					// translators: %s: path of the folder the frontend serves.
					__( 'The frontend’s served folder %s does not exist.' ),
					servedDir
				)
			);
		}
	} else if ( ! frontend.devCommand?.trim() ) {
		throw new LoggerError( __( 'This site’s frontend has no dev command to run.' ) );
	}
}

/**
 * Starts the frontend process for a headless site and resolves once its port
 * accepts connections. WordPress must already be running: the env contract
 * (`buildFrontendEnv`) points the frontend at the site URL.
 */
export async function startFrontendServer(
	site: HeadlessSite,
	logger?: Logger< string >
): Promise< ProcessDescription > {
	const { frontend } = site;
	const processName = getFrontendProcessName( site.id );

	await connectToDaemon();
	const running = await isProcessRunning( processName );
	if ( running ) {
		return running;
	}

	assertFrontendRunnable( frontend );

	let nodePath: string | undefined;
	if ( frontend.kind === 'command' ) {
		const runtime = await requireNodeRuntime( frontend.devCommand ?? '' );
		nodePath = runtime.nodePath;
		logger?.reportProgress(
			sprintf(
				// translators: 1: Node.js version, 2: the frontend URL.
				__( 'Starting frontend with Node.js %1$s on %2$s…' ),
				runtime.version,
				getFrontendUrl( frontend )
			)
		);
	}

	const env = buildFrontendChildEnv( {
		baseEnv: process.env,
		frontend,
		contractEnv: getFrontendEnv( site ),
		nodePath,
	} );

	const readyOrExit = await subscribeForReadyOrExit( processName, {
		timeoutMs: FRONTEND_READY_TIMEOUT_MS + READY_WAIT_MARGIN_MS,
	} );
	try {
		const processDesc = await startProcess( processName, FRONTEND_CHILD_PATH, { env } );
		await readyOrExit.waitFor( processDesc.pmId );
		return processDesc;
	} catch ( error ) {
		try {
			await stopProcess( processName );
		} catch {
			// The process is most likely gone already.
		}
		const { error: errorLog } = getFrontendLogPaths( site.id );
		throw new LoggerError(
			sprintf(
				// translators: %s: path of the frontend's error log file.
				__( 'Failed to start the frontend (see %s)' ),
				errorLog
			),
			error
		);
	} finally {
		readyOrExit.dispose();
	}
}

export async function stopFrontendServer( siteId: string ): Promise< void > {
	await stopProcess( getFrontendProcessName( siteId ) );
}

export async function isFrontendRunning(
	siteId: string
): Promise< ProcessDescription | undefined > {
	return isProcessRunning( getFrontendProcessName( siteId ) );
}

/** Paths of the daemon's stdout and stderr log files for the frontend process. */
export function getFrontendLogPaths( siteId: string ): { out: string; error: string } {
	const { stdoutLogPath, stderrLogPath } = findLatestProcessLogPaths(
		getFrontendProcessName( siteId )
	);
	return { out: stdoutLogPath, error: stderrLogPath };
}

const LOG_TAIL_MAX_BYTES = 256 * 1024;

/**
 * The last `lines` lines of the frontend's output, stdout and stderr merged in
 * time order. Each line starts with the ISO timestamp the daemon wrote.
 */
export function readFrontendLogTail( siteId: string, lines = 100 ): string[] {
	const { out, error } = getFrontendLogPaths( siteId );
	const merged = [
		...( readLastLines( out, lines, LOG_TAIL_MAX_BYTES ) ?? [] ),
		...( readLastLines( error, lines, LOG_TAIL_MAX_BYTES ) ?? [] ),
	];
	return merged
		.map( ( line, index ) => ( { line, index, timestamp: line.slice( 0, line.indexOf( ' ' ) ) } ) )
		.sort( ( a, b ) => a.timestamp.localeCompare( b.timestamp ) || a.index - b.index )
		.map( ( { line } ) => line )
		.slice( -lines );
}
