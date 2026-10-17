import { createHash, randomUUID } from 'crypto';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { getConfigDirectory } from '@studio/common/lib/well-known-paths';
import { withoutOversizedEnvValues } from 'cli/lib/child-env';
import { prepareStudioWpCommand } from 'cli/lib/studio-wp-command';
import type { BashSpawnHook } from '@earendil-works/pi-coding-agent';
import type { WpCliCommandLine } from 'cli/lib/run-wp-cli-command';

export const STUDIO_WP_BROKER_ENV = 'STUDIO_WP_BROKER';

export type StudioWpRequest = { cwd: string; argv: string[]; env: NodeJS.ProcessEnv };
export type StudioWpReply = ( WpCliCommandLine & { env: NodeJS.ProcessEnv } ) | { error: string };

function shellQuote( value: string ): string {
	return `'${ value.replace( /'/g, `'\\''` ) }'`;
}

// `wp` in the agent's shell is WP-CLI on Studio's PHP binary for the site, with Studio's
// SQLite integration loaded; a system `wp`, where one is installed at all, runs on whatever
// PHP the machine has and cannot open a Studio site's database.
//
// Starting the Studio CLI for each command costs seconds, so the client asks the broker in
// the agent's own process for the PHP command line and runs PHP itself, inheriting the
// shell's stdio and environment. Without a broker it runs `studio wp`.
export function getStudioWpClientScript( nodePath: string, cliPath: string ): string {
	return `import net from 'node:net';
import { spawn } from 'node:child_process';

const argv = process.argv.slice( 2 );

function run( command, args, options ) {
	const child = spawn( command, args, { stdio: 'inherit', ...options } );
	for ( const signal of [ 'SIGINT', 'SIGTERM', 'SIGHUP' ] ) {
		process.on( signal, () => child.kill( signal ) );
	}
	child.on( 'error', ( error ) => {
		process.stderr.write( error.message + '\\n' );
		process.exit( 1 );
	} );
	child.on( 'exit', ( code, signal ) => process.exit( code ?? ( signal ? 128 : 1 ) ) );
}

let ranStudioWp = false;
function runStudioWp() {
	if ( ! ranStudioWp ) {
		ranStudioWp = true;
		run( ${ JSON.stringify( nodePath ) }, [ ${ JSON.stringify( cliPath ) }, 'wp', ...argv ] );
	}
}

const broker = process.env.${ STUDIO_WP_BROKER_ENV };
if ( ! broker ) {
	runStudioWp();
} else {
	let reply = '';
	const socket = net.connect( broker );
	socket.setEncoding( 'utf8' );
	socket.on( 'error', runStudioWp );
	socket.on( 'data', ( chunk ) => ( reply += chunk ) );
	socket.on( 'end', () => {
		const line = JSON.parse( reply );
		if ( line.error ) {
			process.stderr.write( line.error + '\\n' );
			process.exit( 1 );
		}
		run( line.command, line.args, { cwd: line.cwd, env: line.env } );
	} );
	socket.end( JSON.stringify( { cwd: process.cwd(), argv, env: process.env } ) + '\\n' );
}
`;
}

export function getStudioWpShimScript( nodePath: string, clientPath: string ): string {
	return `#!/bin/sh\nexec ${ shellQuote( nodePath ) } ${ shellQuote( clientPath ) } "$@"\n`;
}

function writeAtomically( file: string, content: string, mode: number ) {
	if ( ! fs.existsSync( file ) ) {
		const temporaryPath = `${ file }.${ process.pid }`;
		fs.writeFileSync( temporaryPath, content, { mode } );
		fs.renameSync( temporaryPath, file );
	}
}

// Writes `wp` and its client into a directory named after their content, so concurrent
// Studio processes (or different installs) never overwrite each other's files.
export function ensureStudioWpShimDirectory(
	nodePath: string,
	cliPath: string,
	root: string = path.join( getConfigDirectory(), 'tmp', 'agent-bin' )
): string {
	const client = getStudioWpClientScript( nodePath, cliPath );
	const directory = path.join(
		root,
		createHash( 'sha256' ).update( nodePath ).update( client ).digest( 'hex' ).slice( 0, 12 )
	);
	const clientPath = path.join( directory, 'wp-client.mjs' );
	fs.mkdirSync( directory, { recursive: true } );
	writeAtomically( clientPath, client, 0o644 );
	writeAtomically(
		path.join( directory, 'wp' ),
		getStudioWpShimScript( nodePath, clientPath ),
		0o755
	);
	return directory;
}

export async function answerStudioWpRequest(
	request: StudioWpRequest,
	prepare: typeof prepareStudioWpCommand = prepareStudioWpCommand
): Promise< StudioWpReply > {
	try {
		const commandLine = await prepare( request.cwd, request.argv );
		return {
			...commandLine,
			env: withoutOversizedEnvValues( { ...request.env, WP_CLI_ALLOW_ROOT: '1' } ),
		};
	} catch ( error ) {
		return { error: error instanceof Error ? error.message : String( error ) };
	}
}

function getBrokerAddress(): { address: string; cleanup: () => void } {
	if ( process.platform === 'win32' ) {
		return { address: `\\\\.\\pipe\\studio-wp-${ randomUUID() }`, cleanup: () => {} };
	}
	// A private directory, since the socket answers anyone who can reach it.
	const directory = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-wp-' ) );
	return {
		address: path.join( directory, 'broker.sock' ),
		cleanup: () => fs.rmSync( directory, { recursive: true, force: true } ),
	};
}

export function startStudioWpBroker(
	prepare: typeof prepareStudioWpCommand = prepareStudioWpCommand
): { address: string; close: () => void } {
	const { address, cleanup } = getBrokerAddress();
	const server = net.createServer( { allowHalfOpen: true }, ( socket ) => {
		let request = '';
		socket.setEncoding( 'utf8' );
		socket.on( 'error', () => socket.destroy() );
		socket.on( 'data', ( chunk ) => ( request += chunk ) );
		socket.on( 'end', async () => {
			let reply: StudioWpReply;
			try {
				reply = await answerStudioWpRequest( JSON.parse( request ) as StudioWpRequest, prepare );
			} catch ( error ) {
				reply = { error: error instanceof Error ? error.message : String( error ) };
			}
			socket.end( JSON.stringify( reply ) );
		} );
	} );
	server.on( 'error', () => {} );
	server.listen( address );
	// The agent's process should exit when its work does, broker or not.
	server.unref();
	const close = () => {
		server.close();
		cleanup();
	};
	process.once( 'exit', close );
	return { address, close };
}

export function prependToPath(
	directory: string,
	extraEnv: NodeJS.ProcessEnv = {}
): BashSpawnHook {
	return ( context ) => {
		const pathKey =
			Object.keys( context.env ).find( ( key ) => key.toUpperCase() === 'PATH' ) ?? 'PATH';
		const current = context.env[ pathKey ];
		return {
			...context,
			env: {
				...context.env,
				...extraEnv,
				[ pathKey ]: current ? `${ directory }${ path.delimiter }${ current }` : directory,
			},
		};
	};
}
