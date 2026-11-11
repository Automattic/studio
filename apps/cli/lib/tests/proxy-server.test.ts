import net, { type AddressInfo } from 'net';
import {
	PROXY_CONTROL_HEADER,
	PROXY_DISABLE_HTTPS_PATH,
	PROXY_ENABLE_HTTPS_PATH,
} from '@studio/common/constants';
import { vi } from 'vitest';
import { startProxyServers, stopProxyServers } from 'cli/lib/proxy-server';

vi.mock( 'cli/lib/cli-config/core', () => ( {
	readCliConfig: vi.fn().mockResolvedValue( { version: 1, sites: [] } ),
} ) );
vi.mock( 'cli/lib/certificate-manager' );

const listeningPorts = new Map< number, number >();

function request( path: string, headers: Record< string, string > = {}, method = 'POST' ) {
	return fetch( `http://127.0.0.1:${ listeningPorts.get( 80 ) }${ path }`, { method, headers } );
}

async function getStatus(): Promise< { http: boolean; https: boolean } > {
	const response = await request( '/__studio_health', {}, 'GET' );
	return response.json();
}

describe( 'proxy server', () => {
	const control = { [ PROXY_CONTROL_HEADER ]: '1' };

	beforeEach( async () => {
		vi.spyOn( console, 'log' ).mockImplementation( () => undefined );
		vi.spyOn( console, 'error' ).mockImplementation( () => undefined );
		vi.spyOn( process.stdin, 'resume' ).mockImplementation( () => process.stdin );
		vi.spyOn( process, 'on' ).mockImplementation( () => process );

		// Ports 80 and 443 are privileged and may be in use, so listen on free ports instead.
		const listen = net.Server.prototype.listen as (
			this: net.Server,
			port: number,
			host: string,
			callback: () => void
		) => net.Server;
		vi.spyOn( net.Server.prototype, 'listen' ).mockImplementation( function (
			this: net.Server,
			...args: unknown[]
		) {
			const [ port, callback ] = args as [ number, () => void ];
			return listen.call( this, 0, '127.0.0.1', () => {
				listeningPorts.set( port, ( this.address() as AddressInfo ).port );
				callback();
			} );
		} );

		await startProxyServers();
	} );

	afterEach( async () => {
		await stopProxyServers();
		listeningPorts.clear();
		vi.restoreAllMocks();
	} );

	it( 'listens on port 80 only when it starts', async () => {
		expect( await getStatus() ).toMatchObject( { http: true, https: false } );
		expect( listeningPorts.has( 443 ) ).toBe( false );
	} );

	it( 'binds port 443 on request and releases it again', async () => {
		const enabled = await request( PROXY_ENABLE_HTTPS_PATH, control );
		expect( enabled.status ).toBe( 200 );
		expect( await getStatus() ).toMatchObject( { https: true } );

		const httpsPort = listeningPorts.get( 443 )!;
		const disabled = await request( PROXY_DISABLE_HTTPS_PATH, control );
		expect( disabled.status ).toBe( 200 );
		expect( await getStatus() ).toMatchObject( { https: false } );

		await expect(
			new Promise( ( resolve, reject ) => {
				net.connect( httpsPort, '127.0.0.1', () => resolve( 'connected' ) ).on( 'error', reject );
			} )
		).rejects.toMatchObject( { code: 'ECONNREFUSED' } );
	} );

	it( 'stays on port 443 when asked to bind it twice', async () => {
		await request( PROXY_ENABLE_HTTPS_PATH, control );
		const again = await request( PROXY_ENABLE_HTTPS_PATH, control );

		expect( again.status ).toBe( 200 );
		expect( await getStatus() ).toMatchObject( { https: true } );
	} );

	it( 'refuses requests that do not come from the CLI', async () => {
		const withoutHeader = await request( PROXY_ENABLE_HTTPS_PATH );
		const withGet = await request( PROXY_ENABLE_HTTPS_PATH, control, 'GET' );

		expect( withoutHeader.status ).toBe( 403 );
		expect( withGet.status ).toBe( 403 );
		expect( await getStatus() ).toMatchObject( { https: false } );
	} );

	it( 'reports a failure to bind port 443', async () => {
		vi.mocked( net.Server.prototype.listen ).mockImplementationOnce( function ( this: net.Server ) {
			queueMicrotask( () =>
				this.emit(
					'error',
					Object.assign( new Error( 'listen EADDRINUSE: address already in use :::443' ), {
						code: 'EADDRINUSE',
					} )
				)
			);
			return this;
		} );

		const response = await request( PROXY_ENABLE_HTTPS_PATH, control );

		expect( response.status ).toBe( 500 );
		expect( await response.text() ).toContain( 'EADDRINUSE' );
		expect( await getStatus() ).toMatchObject( { https: false } );
	} );
} );
