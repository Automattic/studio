import { randomUUID } from 'crypto';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import type { StudioAgentHost } from '@studio/agent/node/host';

const servers = new WeakMap< StudioAgentHost, Promise< string | undefined > >();

/**
 * Serves the agent's shell the WP-CLI process `studio wp` runs, where the host
 * has one: a client sends a line of JSON, `{ cwd, argv }`, and gets one back,
 * the process or `{ error }`. Resolves to the server's address, a socket only
 * this user can open, or undefined where the host runs no WP-CLI of its own.
 */
export function serveWpCli( host: StudioAgentHost ): Promise< string | undefined > {
	let server = servers.get( host );
	if ( ! server ) {
		server = listen( host ).catch( () => undefined );
		servers.set( host, server );
	}
	return server;
}

async function listen( host: StudioAgentHost ): Promise< string | undefined > {
	const wpCliProcess = host.sites.wpCliProcess?.bind( host.sites );
	if ( ! wpCliProcess ) {
		return undefined;
	}
	const name = `studio-wp-${ process.pid }-${ randomUUID().slice( 0, 8 ) }`;
	const address =
		process.platform === 'win32'
			? `\\\\.\\pipe\\${ name }`
			: path.join( fs.realpathSync( os.tmpdir() ), `${ name }.sock` );
	const server = net.createServer( ( socket ) => {
		let request = '';
		socket.setEncoding( 'utf8' );
		socket.on( 'error', () => {} );
		socket.on( 'data', async ( chunk ) => {
			request += chunk;
			const end = request.indexOf( '\n' );
			if ( end === -1 ) {
				return;
			}
			const reply = await ( async () => {
				const { cwd, argv } = JSON.parse( request.slice( 0, end ) ) as {
					cwd: string;
					argv: string[];
				};
				return wpCliProcess( cwd, argv );
			} )().catch( ( error: unknown ) => ( {
				error: error instanceof Error ? error.message : String( error ),
			} ) );
			socket.end( `${ JSON.stringify( reply ) }\n` );
		} );
	} );
	await new Promise< void >( ( resolve, reject ) => {
		server.once( 'error', reject );
		server.listen( address, resolve );
	} );
	server.unref();
	if ( process.platform !== 'win32' ) {
		fs.chmodSync( address, 0o600 );
		process.once( 'exit', () => fs.rmSync( address, { force: true } ) );
	}
	return address;
}
