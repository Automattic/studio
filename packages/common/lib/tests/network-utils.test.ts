import http from 'http';
import { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isNetworkError } from '../network-utils';

describe( 'isNetworkError', () => {
	// Accepts connections and never answers, like a server behind a stalled network.
	const silent = http.createServer( () => {} );
	let silentUrl = '';

	beforeAll( async () => {
		await new Promise< void >( ( resolve ) => silent.listen( 0, '127.0.0.1', resolve ) );
		silentUrl = `http://127.0.0.1:${ ( silent.address() as AddressInfo ).port }`;
	} );

	afterAll( () => {
		silent.closeAllConnections();
		silent.close();
	} );

	const failedFetch = ( url: string, init?: RequestInit ) =>
		fetch( url, init ).then(
			() => null,
			( error: unknown ) => error
		);

	it.each( [
		[ 'refused connection', () => failedFetch( 'http://127.0.0.1:1' ), true ],
		[
			'request timeout',
			() => failedFetch( silentUrl, { signal: AbortSignal.timeout( 50 ) } ),
			true,
		],
		[
			'error thrown after a response',
			async () => new Error( 'Failed to fetch blueprints: HTTP 500' ),
			false,
		],
		[ 'unrelated TypeError', async () => new TypeError( 'x is not a function' ), false ],
	] )( '%s → %s', async ( _label, produceError, expected ) => {
		expect( isNetworkError( await produceError() ) ).toBe( expected );
	} );
} );
