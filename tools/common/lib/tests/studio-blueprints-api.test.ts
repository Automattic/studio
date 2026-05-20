import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fetchStudioBlueprints } from '../studio-blueprints-api';

const validBlueprint = {
	slug: 'test-blueprint',
	title: 'Test Blueprint',
	excerpt: 'A test blueprint',
	image: 'https://example.com/image.png',
	playground_url: 'https://playground.wordpress.net/',
	blueprint: { steps: [] },
	bundle_url: null,
};

const validResponse = {
	blueprints: [ validBlueprint ],
	total: 1,
};

describe( 'fetchStudioBlueprints', () => {
	let originalFetch: typeof globalThis.fetch;

	beforeEach( () => {
		originalFetch = globalThis.fetch;
	} );

	afterEach( () => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	} );

	it( 'should fetch and return blueprints', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue( {
			ok: true,
			json: () => Promise.resolve( validResponse ),
		} );

		const result = await fetchStudioBlueprints();

		expect( result ).toHaveLength( 1 );
		expect( result[ 0 ].slug ).toBe( 'test-blueprint' );
		expect( result[ 0 ].title ).toBe( 'Test Blueprint' );
	} );

	it( 'should pass locale as query parameter', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue( {
			ok: true,
			json: () => Promise.resolve( validResponse ),
		} );

		await fetchStudioBlueprints( 'fr_FR' );

		expect( globalThis.fetch ).toHaveBeenCalledWith( expect.stringContaining( '?locale=fr_FR' ) );
	} );

	it( 'should not include locale param when not provided', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue( {
			ok: true,
			json: () => Promise.resolve( validResponse ),
		} );

		await fetchStudioBlueprints();

		const calledUrl = vi.mocked( globalThis.fetch ).mock.calls[ 0 ][ 0 ] as string;
		expect( calledUrl ).not.toContain( '?' );
	} );

	it( 'should throw on HTTP error', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue( {
			ok: false,
			status: 500,
		} );

		await expect( fetchStudioBlueprints() ).rejects.toThrow( 'HTTP 500' );
	} );

	it( 'should filter out invalid blueprints from the response', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue( {
			ok: true,
			json: () =>
				Promise.resolve( {
					blueprints: [
						validBlueprint,
						{ slug: 'invalid', title: 'Missing fields' }, // Missing required fields
					],
					total: 2,
				} ),
		} );

		const result = await fetchStudioBlueprints();

		expect( result ).toHaveLength( 1 );
		expect( result[ 0 ].slug ).toBe( 'test-blueprint' );
	} );

	it( 'should throw when response has no blueprints array', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue( {
			ok: true,
			json: () => Promise.resolve( { total: 0 } ),
		} );

		await expect( fetchStudioBlueprints() ).rejects.toThrow( 'Invalid blueprints array' );
	} );

	it( 'should return empty array when all blueprints are invalid', async () => {
		globalThis.fetch = vi.fn().mockResolvedValue( {
			ok: true,
			json: () =>
				Promise.resolve( {
					blueprints: [ { invalid: true } ],
					total: 1,
				} ),
		} );

		const result = await fetchStudioBlueprints();

		expect( result ).toHaveLength( 0 );
	} );
} );
