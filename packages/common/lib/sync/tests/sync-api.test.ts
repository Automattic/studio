import { beforeEach, describe, expect, it, vi } from 'vitest';
import wpcomFactory from '@studio/common/lib/wpcom-factory';
import { fetchAllWpcomSites, fetchSyncableSites } from '../sync-api';

vi.mock( '@studio/common/lib/wpcom-factory', () => ( { default: vi.fn() } ) );
vi.mock( '@studio/common/lib/wpcom-xhr-request-factory', () => ( { default: vi.fn() } ) );

function remoteSite( id: number, overrides: Record< string, unknown > = {} ) {
	return {
		ID: id,
		name: `Site ${ id }`,
		URL: `https://site-${ id }.example.com`,
		is_wpcom_atomic: true,
		jetpack: true,
		is_deleted: false,
		is_a8c: false,
		capabilities: { manage_options: true },
		plan: {
			features: { active: [ 'studio-sync' ] },
			product_id: 1008,
			product_name_short: 'Business',
			product_slug: 'business-bundle',
		},
		options: { created_at: '2026-01-01', wpcom_staging_blog_ids: [] },
		...overrides,
	};
}

describe( 'WordPress.com site fetching', () => {
	const get = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( wpcomFactory ).mockReturnValue( { req: { get } } as never );
	} );

	it( 'keeps the existing single-request fetch contract unchanged', async () => {
		get.mockResolvedValue( { sites: [ remoteSite( 1 ) ] } );

		await expect( fetchSyncableSites( 'token' ) ).resolves.toHaveLength( 1 );
		expect( get ).toHaveBeenCalledWith(
			{ apiNamespace: 'rest/v1.2', path: '/me/sites' },
			expect.not.objectContaining( { page: expect.anything(), per_page: expect.anything() } )
		);
	} );

	it( 'fetches every page for the Connect flow and preserves Pressable sites', async () => {
		get
			.mockResolvedValueOnce( {
				sites: [ remoteSite( 1 ), remoteSite( 2 ) ],
				total: 3,
				page: 1,
				per_page: 2,
			} )
			.mockResolvedValueOnce( {
				sites: [
					remoteSite( 3, {
						hosting_provider_guess: 'pressable',
						plan: undefined,
					} ),
				],
				total: 3,
				page: 2,
				per_page: 100,
			} );

		const sites = await fetchAllWpcomSites( 'token' );

		expect( sites ).toHaveLength( 3 );
		expect( sites.at( -1 ) ).toMatchObject( { id: 3, isPressable: true } );
		expect( get ).toHaveBeenNthCalledWith(
			2,
			{ apiNamespace: 'rest/v1.3', path: '/me/sites' },
			expect.objectContaining( {
				filter: 'atomic,wpcom',
				page: 2,
				per_page: 100,
			} )
		);
	} );
} );
