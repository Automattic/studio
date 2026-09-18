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
