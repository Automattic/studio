import { afterEach, beforeEach, vi } from 'vitest';
import { __bumpStat } from '../bump-stat';

describe( '__bumpStat', () => {
	const originalEnv = { ...process.env };

	beforeEach( () => {
		vi.stubGlobal(
			'fetch',
			vi.fn( () => Promise.resolve( new Response() ) )
		);
		delete process.env.E2E;
		process.env.NODE_ENV = 'production';
	} );

	afterEach( () => {
		vi.unstubAllGlobals();
		process.env = { ...originalEnv };
	} );

	it( "notes a stat it would have bumped on stderr, outside a command's output", () => {
		process.env.E2E = '1';
		const stdout = vi.spyOn( console, 'info' ).mockImplementation( () => {} );
		const stderr = vi.spyOn( console, 'error' ).mockImplementation( () => {} );
		expect( __bumpStat( 'studio-cli', 'mac-arm64' ) ).toBe( false );
		expect( stdout ).not.toHaveBeenCalled();
		expect( stderr ).toHaveBeenCalledWith( 'Would have bumped stat: studio-cli=mac-arm64' );
		expect( fetch ).not.toHaveBeenCalled();
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
} );
