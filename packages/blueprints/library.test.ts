import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchLibraryBlueprints } from './library';

const entry = {
	slug: 'apparel',
	title: 'Apparel',
	excerpt: 'A store',
	image: 'https://example.com/apparel.png',
	playground_url: 'https://playground.wordpress.net/?blueprint-url=apparel',
	bundle_url: 'https://example.com/apparel.zip',
	blueprint: { steps: [] },
};

function respond( body: unknown, ok = true ) {
	return vi.spyOn( globalThis, 'fetch' ).mockResolvedValue( {
		ok,
		status: ok ? 200 : 500,
		json: () => Promise.resolve( body ),
	} as Response );
}

describe( 'fetchLibraryBlueprints', () => {
	afterEach( () => {
		vi.restoreAllMocks();
	} );

	it( 'returns the Library entries in camelCase, without malformed ones', async () => {
		respond( {
			blueprints: [ entry, { slug: 'broken' }, { ...entry, slug: 'plain', bundle_url: null } ],
		} );

		expect( await fetchLibraryBlueprints() ).toEqual( [
			{
				slug: 'apparel',
				title: 'Apparel',
				excerpt: 'A store',
				image: entry.image,
				playgroundUrl: entry.playground_url,
				bundleUrl: entry.bundle_url,
				blueprint: { steps: [] },
			},
			expect.objectContaining( { slug: 'plain', bundleUrl: undefined } ),
		] );
	} );

	it( 'asks for the given locale', async () => {
		const fetch = respond( { blueprints: [] } );
		await fetchLibraryBlueprints( { locale: 'pt_BR' } );
		expect( fetch ).toHaveBeenCalledWith( expect.stringContaining( '?locale=pt_BR' ) );
	} );

	it( 'throws on an HTTP error or an unexpected response', async () => {
		respond( {}, false );
		await expect( fetchLibraryBlueprints() ).rejects.toThrow( 'HTTP 500' );
		respond( { items: [] } );
		await expect( fetchLibraryBlueprints() ).rejects.toThrow(
			'Invalid Blueprint Library response'
		);
	} );
} );
