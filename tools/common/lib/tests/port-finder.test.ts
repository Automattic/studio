import { afterEach, describe, expect, it, vi } from 'vitest';

describe( 'portFinder STUDIO_BASE_PORT', () => {
	afterEach( () => {
		delete process.env.STUDIO_BASE_PORT;
		vi.resetModules();
	} );

	it( 'starts scanning from STUDIO_BASE_PORT when set', async () => {
		process.env.STUDIO_BASE_PORT = '9981';
		vi.resetModules();
		const { portFinder } = await import( '../port-finder' );
		const port = await portFinder.getOpenPort();
		expect( port ).toBeGreaterThanOrEqual( 9981 );
	} );

	it( 'falls back to 8881 when STUDIO_BASE_PORT is unset or invalid', async () => {
		process.env.STUDIO_BASE_PORT = 'not-a-number';
		vi.resetModules();
		const { portFinder } = await import( '../port-finder' );
		const port = await portFinder.getOpenPort();
		expect( port ).toBeGreaterThanOrEqual( 8881 );
		expect( port ).toBeLessThan( 9000 );
	} );
} );
