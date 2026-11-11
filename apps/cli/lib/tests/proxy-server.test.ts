import net from 'net';
import { vi } from 'vitest';

const { readCliConfig } = vi.hoisted( () => ( { readCliConfig: vi.fn() } ) );
vi.mock( 'cli/lib/cli-config/core', () => ( { readCliConfig } ) );
vi.mock( 'cli/lib/certificate-manager' );

describe( 'startProxyServers', () => {
	let listeningPorts: number[];

	beforeEach( () => {
		// The proxy keeps its servers in module state, so each test loads it anew.
		vi.resetModules();
		vi.spyOn( console, 'log' ).mockImplementation( () => undefined );
		vi.spyOn( process.stdin, 'resume' ).mockImplementation( () => process.stdin );
		vi.spyOn( process, 'on' ).mockImplementation( () => process );

		listeningPorts = [];
		vi.spyOn( net.Server.prototype, 'listen' ).mockImplementation( function (
			this: net.Server,
			...args: unknown[]
		) {
			const [ port, onListening ] = args as [ number, () => void ];
			listeningPorts.push( port );
			queueMicrotask( onListening );
			return this;
		} );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	it( 'should leave port 443 free when no site uses HTTPS', async () => {
		readCliConfig.mockResolvedValue( {
			version: 1,
			sites: [ { customDomain: 'site.local' }, { enableHttps: true } ],
		} );
		const { startProxyServers } = await import( 'cli/lib/proxy-server' );

		await startProxyServers();

		expect( listeningPorts ).toEqual( [ 80 ] );
	} );

	it( 'should take port 443 when a site with a custom domain uses HTTPS', async () => {
		readCliConfig.mockResolvedValue( {
			version: 1,
			sites: [ { customDomain: 'site.local', enableHttps: true } ],
		} );
		const { startProxyServers } = await import( 'cli/lib/proxy-server' );

		await startProxyServers();

		expect( listeningPorts ).toEqual( [ 80, 443 ] );
	} );
} );
