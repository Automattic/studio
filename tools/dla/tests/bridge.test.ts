/**
 * Tests for the bridge lifecycle (`startDlaBridge` / `dispose`).
 *
 * The bridge spawns a Node + tsx child process in production, which is
 * far too heavy for unit tests. We swap in a `BridgeTransportProvider`
 * stub that returns a mocked MCP client and a fake pid, then assert on
 * the bridge's behaviour around it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startDlaBridge, type BridgeTransportProvider } from '../bridge';

interface MockClient {
	callTool: ReturnType< typeof vi.fn >;
	listTools: ReturnType< typeof vi.fn >;
	close: ReturnType< typeof vi.fn >;
}

function makeMockClient( overrides: Partial< MockClient > = {} ): MockClient {
	return {
		callTool: overrides.callTool ?? vi.fn(),
		listTools:
			overrides.listTools ??
			vi.fn().mockResolvedValue( {
				tools: [
					{
						name: 'liberate_detect',
						description: 'Detect platform',
						inputSchema: { type: 'object' },
					},
					{
						name: 'liberate_inspect',
						description: 'Inspect site',
						inputSchema: { type: 'object' },
					},
					{
						name: 'liberate_status',
						description: 'Read status',
						inputSchema: { type: 'object' },
					},
				],
			} ),
		close: overrides.close ?? vi.fn().mockResolvedValue( undefined ),
	};
}

function makeTransport( client: MockClient, pid: number | null = 12345 ): BridgeTransportProvider {
	return {
		connect: vi.fn().mockResolvedValue( { client, pid } ),
	};
}

describe( 'startDlaBridge', () => {
	let warnSpy: ReturnType< typeof vi.spyOn >;
	beforeEach( () => {
		warnSpy = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );
	} );
	afterEach( () => {
		warnSpy.mockRestore();
		vi.useRealTimers();
	} );

	it( 'connects, lists tools, and returns adapted tools', async () => {
		const client = makeMockClient();
		const transport = makeTransport( client );

		const bridge = await startDlaBridge( { transport } );

		expect( transport.connect ).toHaveBeenCalledOnce();
		expect( client.listTools ).toHaveBeenCalledOnce();
		expect( bridge.tools ).toHaveLength( 3 );
		expect( bridge.tools.map( ( t ) => t.name ) ).toEqual( [
			'liberate_detect',
			'liberate_inspect',
			'liberate_status',
		] );
		expect( bridge.degraded ).toBe( false );
	} );

	it( 'forwards wpcomToken into the child env as STUDIO_WPCOM_TOKEN', async () => {
		const client = makeMockClient();
		const connect = vi.fn().mockResolvedValue( { client, pid: 1 } );
		const transport: BridgeTransportProvider = { connect };

		await startDlaBridge( { transport, wpcomToken: 'secret-token' } );

		expect( connect ).toHaveBeenCalledWith(
			expect.objectContaining( { STUDIO_WPCOM_TOKEN: 'secret-token' } )
		);
	} );

	it( 'passes through LIBERATION_TOKEN and SHOPIFY_ADMIN_TOKEN env vars', async () => {
		const previousLiberation = process.env.LIBERATION_TOKEN;
		const previousShopify = process.env.SHOPIFY_ADMIN_TOKEN;
		process.env.LIBERATION_TOKEN = 'lib-token';
		process.env.SHOPIFY_ADMIN_TOKEN = 'shop-token';

		try {
			const client = makeMockClient();
			const connect = vi.fn().mockResolvedValue( { client, pid: 1 } );
			const transport: BridgeTransportProvider = { connect };

			await startDlaBridge( { transport } );

			expect( connect ).toHaveBeenCalledWith(
				expect.objectContaining( {
					LIBERATION_TOKEN: 'lib-token',
					SHOPIFY_ADMIN_TOKEN: 'shop-token',
				} )
			);
		} finally {
			if ( previousLiberation === undefined ) {
				delete process.env.LIBERATION_TOKEN;
			} else {
				process.env.LIBERATION_TOKEN = previousLiberation;
			}
			if ( previousShopify === undefined ) {
				delete process.env.SHOPIFY_ADMIN_TOKEN;
			} else {
				process.env.SHOPIFY_ADMIN_TOKEN = previousShopify;
			}
		}
	} );

	it( 'returns empty tools and warns when transport.connect rejects', async () => {
		const transport: BridgeTransportProvider = {
			connect: vi.fn().mockRejectedValue( new Error( 'spawn failed' ) ),
		};

		const bridge = await startDlaBridge( { transport } );

		expect( bridge.tools ).toEqual( [] );
		expect( bridge.degraded ).toBe( true );
		expect( bridge.degradationReason ).toMatch( /spawn failed/ );
		expect( warnSpy ).toHaveBeenCalledWith(
			expect.stringContaining( 'failed to spawn DLA MCP server' )
		);
	} );

	it( 'returns empty tools and warns when listTools rejects (timeout path)', async () => {
		const client = makeMockClient( {
			listTools: vi.fn().mockRejectedValue( new Error( 'aborted' ) ),
		} );
		const transport = makeTransport( client );

		const bridge = await startDlaBridge( { transport } );

		expect( bridge.tools ).toEqual( [] );
		expect( bridge.degraded ).toBe( true );
		expect( bridge.degradationReason ).toMatch( /aborted/ );
		expect( warnSpy ).toHaveBeenCalledWith( expect.stringContaining( 'listTools failed' ) );
	} );

	it( 'uses the configured listToolsTimeoutMs', async () => {
		const client = makeMockClient( {
			listTools: vi.fn().mockImplementation( ( _, opts: { signal?: AbortSignal } ) => {
				return new Promise( ( resolve, reject ) => {
					if ( opts.signal ) {
						opts.signal.addEventListener( 'abort', () => reject( new Error( 'timed out' ) ) );
					}
					// Never resolve; rely on signal abort.
				} );
			} ),
		} );
		const transport = makeTransport( client );

		const bridge = await startDlaBridge( {
			transport,
			listToolsTimeoutMs: 5,
		} );
		expect( bridge.tools ).toEqual( [] );
		expect( bridge.degraded ).toBe( true );
	} );

	it( 'dispose() calls client.close exactly once', async () => {
		const client = makeMockClient();
		const transport = makeTransport( client );

		const bridge = await startDlaBridge( { transport } );
		await bridge.dispose();
		await bridge.dispose();

		expect( client.close ).toHaveBeenCalledOnce();
	} );

	it( 'dispose() schedules SIGKILL after the grace period', async () => {
		vi.useFakeTimers();
		const client = makeMockClient();
		const transport = makeTransport( client, 999_999 );
		const killSpy = vi.spyOn( process, 'kill' ).mockImplementation( () => true );

		const bridge = await startDlaBridge( { transport } );
		await bridge.dispose();

		// Grace period not elapsed yet — kill should not have fired.
		expect( killSpy ).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync( 2_001 );
		expect( killSpy ).toHaveBeenCalledWith( 999_999, 'SIGKILL' );

		killSpy.mockRestore();
	} );

	it( 'dispose() does not schedule SIGKILL when pid is null', async () => {
		vi.useFakeTimers();
		const client = makeMockClient();
		const transport = makeTransport( client, null );
		const killSpy = vi.spyOn( process, 'kill' ).mockImplementation( () => true );

		const bridge = await startDlaBridge( { transport } );
		await bridge.dispose();
		await vi.advanceTimersByTimeAsync( 5_000 );

		expect( killSpy ).not.toHaveBeenCalled();
		killSpy.mockRestore();
	} );

	it( 'dispose() tolerates a close() rejection and still schedules SIGKILL', async () => {
		vi.useFakeTimers();
		const client = makeMockClient( {
			close: vi.fn().mockRejectedValue( new Error( 'already closed' ) ),
		} );
		const transport = makeTransport( client, 12 );
		const killSpy = vi.spyOn( process, 'kill' ).mockImplementation( () => true );

		const bridge = await startDlaBridge( { transport } );
		await bridge.dispose();
		await vi.advanceTimersByTimeAsync( 2_001 );

		expect( killSpy ).toHaveBeenCalledWith( 12, 'SIGKILL' );
		killSpy.mockRestore();
	} );
} );

describe( 'startDlaBridge — integration with adapter', () => {
	it( 'adapted tools forward to the same MCP client', async () => {
		const client = makeMockClient( {
			callTool: vi.fn().mockResolvedValue( {
				content: [ { type: 'text', text: 'detected' } ],
			} ),
		} );
		const transport = makeTransport( client );

		const bridge = await startDlaBridge( { transport } );
		const detect = bridge.tools.find( ( t ) => t.name === 'liberate_detect' );
		expect( detect ).toBeDefined();

		const result = await detect!.execute(
			'tc-1',
			{ url: 'https://example.com' },
			undefined,
			undefined,
			{} as never
		);
		expect( client.callTool ).toHaveBeenCalledWith(
			{ name: 'liberate_detect', arguments: { url: 'https://example.com' } },
			undefined,
			{ signal: undefined }
		);
		expect( result.content ).toEqual( [ { type: 'text', text: 'detected' } ] );
	} );
} );
