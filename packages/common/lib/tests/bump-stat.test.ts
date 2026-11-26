import { afterEach, beforeEach, vi } from 'vitest';
import { __bumpStat } from '../bump-stat';

describe( '__bumpStat', () => {
	const originalEnv = { ...process.env };

	beforeEach( () => {
		vi.stubGlobal(
			'fetch',
			vi.fn( () => Promise.resolve( new Response() ) )
		);
		// The suite itself runs under Vitest, and under CI on CI.
		for ( const name of [ 'E2E', 'CI', 'VITEST' ] ) {
			delete process.env[ name ];
		}
		process.env.NODE_ENV = 'production';
	} );

	afterEach( () => {
		vi.unstubAllGlobals();
		process.env = { ...originalEnv };
	} );

	it( 'bounds the fire-and-forget request', () => {
		expect( __bumpStat( 'studio-cli', 'mac-arm64' ) ).toBe( true );
		expect( fetch ).toHaveBeenCalledWith(
			'https://public-api.wordpress.com/wpcom/v2/studio-app/bump-stat',
			expect.objectContaining( {
				method: 'POST',
				signal: expect.any( AbortSignal ),
			} )
		);
	} );

	it.each( [
		[ 'E2E', 'true' ],
		[ 'CI', 'true' ],
		[ 'VITEST', 'true' ],
		[ 'NODE_ENV', 'test' ],
	] )( 'no-ops when %s is %s', ( name, value ) => {
		process.env[ name ] = value;

		expect( __bumpStat( 'studio-cli', 'mac-arm64' ) ).toBe( false );
		expect( fetch ).not.toHaveBeenCalled();
	} );
} );
