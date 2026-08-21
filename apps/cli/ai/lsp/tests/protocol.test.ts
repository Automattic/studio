import { describe, expect, it } from 'vitest';
import { encodeMessage, LspMessageReader, type JsonRpcMessage } from '../protocol';

function frame( message: object ): Buffer {
	return encodeMessage( message as JsonRpcMessage );
}

describe( 'encodeMessage', () => {
	it( 'produces a Content-Length framed JSON body', () => {
		const encoded = encodeMessage( { jsonrpc: '2.0', id: 1, method: 'initialize' } ).toString();
		const body = JSON.stringify( { jsonrpc: '2.0', id: 1, method: 'initialize' } );
		expect( encoded ).toBe( `Content-Length: ${ Buffer.byteLength( body ) }\r\n\r\n${ body }` );
	} );

	it( 'measures multibyte content in bytes, not characters', () => {
		const message: JsonRpcMessage = { jsonrpc: '2.0', method: 'x', params: { text: 'héllo' } };
		const encoded = encodeMessage( message );
		const reader = new LspMessageReader();
		expect( reader.push( encoded ) ).toEqual( [ message ] );
	} );
} );

describe( 'LspMessageReader', () => {
	it( 'parses a complete frame', () => {
		const reader = new LspMessageReader();
		const messages = reader.push( frame( { jsonrpc: '2.0', id: 1, result: { ok: true } } ) );
		expect( messages ).toEqual( [ { jsonrpc: '2.0', id: 1, result: { ok: true } } ] );
	} );

	it( 'parses multiple frames in a single chunk', () => {
		const reader = new LspMessageReader();
		const chunk = Buffer.concat( [
			frame( { jsonrpc: '2.0', id: 1, result: 1 } ),
			frame( { jsonrpc: '2.0', id: 2, result: 2 } ),
		] );
		expect( reader.push( chunk ) ).toHaveLength( 2 );
	} );

	it( 'buffers a frame split across arbitrary chunk boundaries', () => {
		const reader = new LspMessageReader();
		const encoded = frame( { jsonrpc: '2.0', id: 7, result: 'split' } );
		const collected: JsonRpcMessage[] = [];
		for ( let i = 0; i < encoded.length; i += 3 ) {
			collected.push( ...reader.push( encoded.subarray( i, i + 3 ) ) );
		}
		expect( collected ).toEqual( [ { jsonrpc: '2.0', id: 7, result: 'split' } ] );
	} );

	it( 'keeps trailing partial data for the next push', () => {
		const reader = new LspMessageReader();
		const first = frame( { jsonrpc: '2.0', id: 1, result: 'a' } );
		const second = frame( { jsonrpc: '2.0', id: 2, result: 'b' } );
		const joined = Buffer.concat( [ first, second ] );
		const messages = reader.push( joined.subarray( 0, first.length + 5 ) );
		expect( messages ).toHaveLength( 1 );
		expect( reader.push( joined.subarray( first.length + 5 ) ) ).toEqual( [
			{ jsonrpc: '2.0', id: 2, result: 'b' },
		] );
	} );

	it( 'throws on a malformed header', () => {
		const reader = new LspMessageReader();
		expect( () => reader.push( Buffer.from( 'Not-A-Header: nope\r\n\r\n{}' ) ) ).toThrow(
			'malformed protocol header'
		);
	} );
} );
