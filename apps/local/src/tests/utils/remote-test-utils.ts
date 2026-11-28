import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createPairingCode } from '@studio/common/lib/remote-access';
import { startLocalServer, type LocalServer, type LocalServerOptions } from '../../index';

export interface Reply {
	status: number;
	json: Record< string, unknown > | undefined;
	text: string;
}

export interface RequestOptions {
	method?: string;
	path: string;
	token?: string;
	origin?: string;
	headers?: Record< string, string >;
	body?: unknown;
	// Sent as is, for payloads that are not JSON.
	rawBody?: string;
}

export function request( port: number, options: RequestOptions ): Promise< Reply > {
	return new Promise( ( resolve, reject ) => {
		const payload =
			options.rawBody ??
			( options.body === undefined ? undefined : JSON.stringify( options.body ) );
		const req = http.request(
			{
				host: '127.0.0.1',
				port,
				path: options.path,
				method: options.method ?? 'GET',
				headers: {
					...( payload === undefined
						? {}
						: {
								'content-type': 'application/json',
								'content-length': Buffer.byteLength( payload ),
						  } ),
					...( options.token ? { authorization: `Bearer ${ options.token }` } : {} ),
					...( options.origin ? { origin: options.origin } : {} ),
					...options.headers,
				},
			},
			( response ) => {
				let text = '';
				response.setEncoding( 'utf8' );
				response.on( 'data', ( chunk ) => ( text += chunk ) );
				response.on( 'end', () => {
					let json: Record< string, unknown > | undefined;
					try {
						json = text ? JSON.parse( text ) : undefined;
					} catch {
						json = undefined;
					}
					resolve( { status: response.statusCode ?? 0, json, text } );
				} );
			}
		);
		req.on( 'error', reject );
		if ( payload !== undefined ) {
			req.write( payload );
		}
		req.end();
	} );
}

export async function pairDevice( port: number ): Promise< { token: string; deviceId: string } > {
	const { code } = await createPairingCode();
	const reply = await request( port, {
		method: 'POST',
		path: '/api/remote/pair',
		body: { code, deviceName: 'Test phone', platform: 'ios' },
	} );
	return reply.json as { token: string; deviceId: string };
}

export interface Stream {
	status: number;
	// Everything received so far.
	received(): string;
	// Resolves when the server ends the stream (or the connection drops).
	ended: Promise< void >;
	destroy(): void;
}

export function openStream( port: number, token?: string ): Promise< Stream > {
	return new Promise( ( resolve, reject ) => {
		let received = '';
		const req = http.request(
			{
				host: '127.0.0.1',
				port,
				path: '/api/events',
				headers: token ? { authorization: `Bearer ${ token }` } : {},
			},
			( response ) => {
				response.setEncoding( 'utf8' );
				response.on( 'data', ( chunk ) => ( received += chunk ) );
				const ended = new Promise< void >( ( done ) => {
					response.on( 'end', done );
					response.on( 'close', done );
				} );
				resolve( {
					status: response.statusCode ?? 0,
					received: () => received,
					ended,
					destroy: () => req.destroy(),
				} );
			}
		);
		req.on( 'error', ( error ) => {
			// Destroying the request on purpose lands here.
			if ( ( error as NodeJS.ErrnoException ).code !== 'ECONNRESET' ) {
				reject( error );
			}
		} );
		req.end();
	} );
}

// Resolves true if `promise` settles within `ms`, false otherwise.
export function settlesWithin( promise: Promise< unknown >, ms: number ): Promise< boolean > {
	return Promise.race( [
		promise.then( () => true ),
		new Promise< boolean >( ( resolve ) => setTimeout( () => resolve( false ), ms ) ),
	] );
}

export const baseServerOptions = {
	cliBinary: path.join( os.tmpdir(), 'studio-test-cli.mjs' ),
	sessionsRoot: path.join( os.tmpdir(), 'studio-test-sessions' ),
	sitesRoot: path.join( os.tmpdir(), 'studio-test-sites' ),
	port: 0,
};

export interface TestRemoteServer {
	server: LocalServer;
	configDir: string;
	stop(): Promise< void >;
}

// `DEV_CONFIG_DIR` is process-wide: start one of these per test file.
export async function startRemoteTestServer(
	overrides: Partial< LocalServerOptions > = {}
): Promise< TestRemoteServer > {
	const configDir = mkdtempSync( path.join( os.tmpdir(), 'studio-remote-test-' ) );
	process.env.DEV_CONFIG_DIR = configDir;
	try {
		const server = await startLocalServer( {
			...baseServerOptions,
			host: '127.0.0.1',
			remote: { label: 'Test Mac', studioVersion: '0.0.0-test' },
			...overrides,
		} );
		return {
			server,
			configDir,
			async stop() {
				await server.close();
				delete process.env.DEV_CONFIG_DIR;
				rmSync( configDir, { recursive: true, force: true } );
			},
		};
	} catch ( error ) {
		delete process.env.DEV_CONFIG_DIR;
		rmSync( configDir, { recursive: true, force: true } );
		throw error;
	}
}
