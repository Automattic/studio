import { PassThrough } from 'stream';
import { describe, expect, it } from 'vitest';
import { LspClient, toFileUri } from '../client';
import { encodeMessage, LspMessageReader, type JsonRpcMessage } from '../protocol';

interface TestHarness {
	client: LspClient;
	// Messages the client wrote, in order.
	sent: JsonRpcMessage[];
	// Push a message from the "server" to the client.
	receive: ( message: JsonRpcMessage ) => void;
	// Resolves once the client has written `count` messages.
	whenSent: ( count: number ) => Promise< void >;
}

function createHarness(): TestHarness {
	const toServer = new PassThrough();
	const toClient = new PassThrough();
	const reader = new LspMessageReader();
	const sent: JsonRpcMessage[] = [];
	const sentWaiters: Array< { count: number; resolve: () => void } > = [];
	toServer.on( 'data', ( chunk: Buffer ) => {
		sent.push( ...reader.push( chunk ) );
		for ( const waiter of [ ...sentWaiters ] ) {
			if ( sent.length >= waiter.count ) {
				sentWaiters.splice( sentWaiters.indexOf( waiter ), 1 );
				waiter.resolve();
			}
		}
	} );
	return {
		client: new LspClient( toServer, toClient ),
		sent,
		receive: ( message ) => toClient.write( encodeMessage( message ) ),
		whenSent: ( count ) =>
			new Promise( ( resolve ) => {
				if ( sent.length >= count ) {
					resolve();
				} else {
					sentWaiters.push( { count, resolve } );
				}
			} ),
	};
}

describe( 'LspClient', () => {
	it( 'resolves a request with the matching response result', async () => {
		const harness = createHarness();
		const pending = harness.client.request( 'initialize', { rootUri: 'file:///x' } );
		await harness.whenSent( 1 );
		const request = harness.sent[ 0 ] as { id: number; method: string };
		expect( request.method ).toBe( 'initialize' );
		harness.receive( { jsonrpc: '2.0', id: request.id, result: { capabilities: {} } } );
		await expect( pending ).resolves.toEqual( { capabilities: {} } );
	} );

	it( 'rejects a request when the server answers with an error', async () => {
		const harness = createHarness();
		const pending = harness.client.request( 'textDocument/hover', {} );
		await harness.whenSent( 1 );
		const request = harness.sent[ 0 ] as { id: number };
		harness.receive( {
			jsonrpc: '2.0',
			id: request.id,
			error: { code: -32601, message: 'method not found' },
		} );
		await expect( pending ).rejects.toThrow( 'method not found' );
	} );

	it( 'times out a request that never gets a response', async () => {
		const harness = createHarness();
		await expect( harness.client.request( 'slow/method', {}, 20 ) ).rejects.toThrow( 'timed out' );
	} );

	it( 'answers server-to-client requests with a null result', async () => {
		const harness = createHarness();
		harness.receive( { jsonrpc: '2.0', id: 42, method: 'client/registerCapability', params: {} } );
		await harness.whenSent( 1 );
		expect( harness.sent[ 0 ] ).toEqual( { jsonrpc: '2.0', id: 42, result: null } );
	} );

	it( 'sends didOpen on first sync and versioned didChange afterwards', async () => {
		const harness = createHarness();
		const uri = harness.client.syncDocument( '/tmp/site/a.php', '<?php one();' );
		harness.client.syncDocument( '/tmp/site/a.php', '<?php two();' );
		await harness.whenSent( 2 );
		expect( uri ).toBe( toFileUri( '/tmp/site/a.php' ) );
		expect( harness.sent[ 0 ] ).toMatchObject( {
			method: 'textDocument/didOpen',
			params: { textDocument: { uri, version: 1, text: '<?php one();' } },
		} );
		expect( harness.sent[ 1 ] ).toMatchObject( {
			method: 'textDocument/didChange',
			params: {
				textDocument: { uri, version: 2 },
				contentChanges: [ { text: '<?php two();' } ],
			},
		} );
	} );

	it( 'resolves waitForDiagnostics with the next publish for the uri', async () => {
		const harness = createHarness();
		const uri = 'file:///tmp/site/a.php';
		const pending = harness.client.waitForDiagnostics( uri, 1_000 );
		const diagnostics = [
			{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: 'x' },
		];
		harness.receive( {
			jsonrpc: '2.0',
			method: 'textDocument/publishDiagnostics',
			params: { uri, diagnostics },
		} );
		await expect( pending ).resolves.toEqual( diagnostics );
		expect( harness.client.getCachedDiagnostics( uri ) ).toEqual( diagnostics );
	} );

	it( 'falls back to cached diagnostics when no publish arrives in time', async () => {
		const harness = createHarness();
		const uri = 'file:///tmp/site/b.php';
		harness.receive( {
			jsonrpc: '2.0',
			method: 'textDocument/publishDiagnostics',
			params: { uri, diagnostics: [] },
		} );
		// Give the receive a tick to be processed, then wait with a tiny timeout.
		await new Promise( ( resolve ) => setTimeout( resolve, 10 ) );
		await expect( harness.client.waitForDiagnostics( uri, 20 ) ).resolves.toEqual( [] );
	} );

	it( 'rejects pending requests and resolves waiters on dispose', async () => {
		const harness = createHarness();
		const pendingRequest = harness.client.request( 'initialize', {} );
		const pendingDiagnostics = harness.client.waitForDiagnostics( 'file:///x.php', 5_000 );
		harness.client.dispose( 'server exited with code 1' );
		await expect( pendingRequest ).rejects.toThrow( 'server exited with code 1' );
		await expect( pendingDiagnostics ).resolves.toEqual( [] );
		expect( harness.client.isDisposed() ).toBe( true );
		await expect( harness.client.request( 'x', {} ) ).rejects.toThrow( 'closed' );
	} );
} );
