/**
 * Runs the frontend half of a headless site under the process-manager daemon:
 * serves a folder of static files, or supervises the project's dev server.
 *
 * Configured through env vars (`lib/frontend/child-config.ts`). Sends `ready`
 * once the frontend port accepts connections; exits non-zero, with the reason
 * on stderr, when it can't get there.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import {
	buildDevServerEnv,
	parseFrontendChildConfig,
	type FrontendChildConfig,
} from './lib/frontend/child-config';
import { isPortListening, PortWaitAbortedError, waitForPortListening } from './lib/frontend/port';
import { buildShellInvocation } from './lib/frontend/shell';
import { getContentType, getNotFoundPage, resolveStaticRequest } from './lib/frontend/static-files';

type StaticConfig = Extract< FrontendChildConfig, { kind: 'static' } >;
type CommandConfig = Extract< FrontendChildConfig, { kind: 'command' } >;

// Below the daemon's own 2.5 s stop timeout, so the group is killed by us first.
const KILL_GRACE_MS = 2_000;

let staticServer: http.Server | null = null;
let devServer: ChildProcess | null = null;
let devServerExited = false;
let isReady = false;
let isShuttingDown = false;

function log( ...args: Parameters< typeof console.log > ) {
	console.log( '[Frontend]', ...args );
}

function logError( ...args: Parameters< typeof console.error > ) {
	console.error( '[Frontend]', ...args );
}

function exitWithError( message: string, code = 1 ): never {
	logError( message );
	signalDevServer( 'SIGKILL' );
	process.exit( code );
}

function signalExitCode( signal: NodeJS.Signals | null ): number {
	return signal ? 128 + ( os.constants.signals[ signal ] ?? 0 ) : 1;
}

function sendReady() {
	isReady = true;
	process.send?.( { topic: 'ready' } );
}

function serveFile(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	filePath: string,
	statusCode = 200
) {
	res.writeHead( statusCode, {
		'Content-Type': getContentType( filePath ),
		'Cache-Control': 'no-cache',
	} );
	if ( req.method === 'HEAD' ) {
		res.end();
		return;
	}
	const stream = fs.createReadStream( filePath );
	stream.on( 'error', () => res.destroy() );
	stream.pipe( res );
}

function handleStaticRequest( root: string, req: http.IncomingMessage, res: http.ServerResponse ) {
	if ( req.method !== 'GET' && req.method !== 'HEAD' ) {
		res.writeHead( 405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' } );
		res.end( 'Method Not Allowed' );
		return;
	}

	const resolution = resolveStaticRequest( root, req.url ?? '/' );
	if ( resolution.type === 'file' ) {
		serveFile( req, res, resolution.filePath );
		return;
	}
	if ( resolution.type === 'redirect' ) {
		res.writeHead( 301, { Location: resolution.location } );
		res.end();
		return;
	}

	const notFoundPage = getNotFoundPage( root );
	if ( notFoundPage ) {
		serveFile( req, res, notFoundPage, 404 );
		return;
	}
	res.writeHead( 404, { 'Content-Type': 'text/plain; charset=utf-8' } );
	res.end( 'Not Found' );
}

async function startStaticServer( config: StaticConfig ): Promise< void > {
	if ( ! fs.statSync( config.servedDir, { throwIfNoEntry: false } )?.isDirectory() ) {
		exitWithError( `The folder to serve does not exist: ${ config.servedDir }` );
	}

	const server = http.createServer( ( req, res ) =>
		handleStaticRequest( config.servedDir, req, res )
	);
	staticServer = server;
	try {
		await new Promise< void >( ( resolve, reject ) => {
			server.once( 'error', reject );
			server.listen( config.port, 'localhost', () => {
				server.off( 'error', reject );
				resolve();
			} );
		} );
	} catch ( error ) {
		const code = ( error as NodeJS.ErrnoException ).code;
		exitWithError(
			code === 'EADDRINUSE'
				? `Port ${ config.port } is already in use by another process`
				: `Could not serve ${ config.servedDir }: ${ String( error ) }`
		);
	}
	log( `Serving ${ config.servedDir } on http://localhost:${ config.port }` );
	sendReady();
}

// POSIX dev servers lead their own process group (`detached`), so one signal
// reaches the shell, npm and the framework's workers alike. The group can
// outlive its leader, so this is sent even after the shell exits.
function signalDevServer( signal: NodeJS.Signals ) {
	const pid = devServer?.pid;
	if ( ! pid ) {
		return;
	}
	if ( process.platform === 'win32' ) {
		if ( ! devServerExited ) {
			spawnSync( 'taskkill', [ '/T', '/F', '/PID', String( pid ) ], {
				windowsHide: true,
				stdio: 'ignore',
			} );
		}
		return;
	}
	try {
		process.kill( -pid, signal );
	} catch {
		if ( ! devServerExited ) {
			try {
				devServer?.kill( signal );
			} catch {
				// Already gone.
			}
		}
	}
}

async function stopDevServer(): Promise< void > {
	const child = devServer;
	if ( ! child ) {
		return;
	}
	if ( ! devServerExited ) {
		const exited = new Promise< void >( ( resolve ) => child.once( 'exit', () => resolve() ) );
		signalDevServer( 'SIGTERM' );
		await Promise.race( [
			exited,
			new Promise( ( resolve ) => setTimeout( resolve, KILL_GRACE_MS ) ),
		] );
	}
	signalDevServer( 'SIGKILL' );
	devServer = null;
}

async function startDevServer( config: CommandConfig ): Promise< void > {
	if ( ! fs.statSync( config.projectPath, { throwIfNoEntry: false } )?.isDirectory() ) {
		exitWithError( `The frontend folder does not exist: ${ config.projectPath }` );
	}
	// A dev server that finds its port taken picks another (Next.js does), and a
	// readiness check on our port would then pass against the wrong process.
	if ( await isPortListening( config.port ) ) {
		exitWithError( `Port ${ config.port } is already in use by another process` );
	}

	const invocation = buildShellInvocation( config.command );
	log( `Running \`${ config.command }\` in ${ config.projectPath }` );
	const child = spawn( invocation.file, invocation.args, {
		cwd: config.projectPath,
		env: buildDevServerEnv( process.env, config ),
		stdio: [ 'ignore', 'inherit', 'inherit' ],
		detached: process.platform !== 'win32',
		windowsHide: true,
		windowsVerbatimArguments: invocation.windowsVerbatimArguments,
	} );
	devServer = child;

	child.once( 'error', ( error ) => {
		devServerExited = true;
		exitWithError( `Could not run \`${ config.command }\`: ${ error.message }` );
	} );
	child.once( 'exit', ( code, signal ) => {
		devServerExited = true;
		if ( isShuttingDown ) {
			return;
		}
		const status = signal ? `signal ${ signal }` : `code ${ code }`;
		if ( ! isReady ) {
			exitWithError(
				`The dev server exited (${ status }) before it was listening on port ${ config.port }`,
				code || signalExitCode( signal )
			);
		}
		logError( `The dev server exited (${ status })` );
		signalDevServer( 'SIGKILL' );
		process.exit( code ?? signalExitCode( signal ) );
	} );

	if ( child.pid ) {
		// The daemon also signals this group when it stops us, in case we're killed first.
		process.send?.( { topic: 'server-process-started', data: { pid: child.pid } } );
	}

	try {
		await waitForPortListening( config.port, {
			timeoutMs: config.readyTimeoutMs,
			isAborted: () => devServerExited,
		} );
	} catch ( error ) {
		if ( error instanceof PortWaitAbortedError ) {
			return;
		}
		isShuttingDown = true;
		await stopDevServer();
		exitWithError(
			`The dev server did not start listening on port ${ config.port } within ${ Math.round(
				config.readyTimeoutMs / 1000
			) }s. Check that its command uses the port Studio passes (\${port} or PORT).`
		);
	}
	log( `Dev server listening on http://localhost:${ config.port }` );
	sendReady();
}

async function shutdown( reason: string, code: number ): Promise< void > {
	if ( isShuttingDown ) {
		return;
	}
	isShuttingDown = true;
	log( `${ reason }, shutting down` );
	staticServer?.close();
	staticServer?.closeAllConnections();
	await stopDevServer();
	process.exit( code );
}

process.on( 'SIGTERM', () => void shutdown( 'Received SIGTERM', signalExitCode( 'SIGTERM' ) ) );
process.on( 'SIGINT', () => void shutdown( 'Received SIGINT', signalExitCode( 'SIGINT' ) ) );
// The daemon is gone, or (on Windows, which has no SIGTERM) is stopping us.
process.on( 'disconnect', () => void shutdown( 'IPC channel disconnected', 0 ) );
process.on( 'exit', () => signalDevServer( 'SIGKILL' ) );

async function main() {
	let config: FrontendChildConfig;
	try {
		config = parseFrontendChildConfig( process.env );
	} catch ( error ) {
		exitWithError( `Invalid frontend configuration: ${ String( error ) }` );
	}

	if ( config.kind === 'static' ) {
		await startStaticServer( config );
	} else {
		await startDevServer( config );
	}
}

void main().catch( ( error ) => {
	exitWithError( `Frontend failed to start: ${ error instanceof Error ? error.stack : error }` );
} );
