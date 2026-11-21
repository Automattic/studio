import { getRemoteSites } from '@studio/common/lib/remote-sites';
import { vi } from 'vitest';
import { deleteSnapshotSite, getLivePreviewSite } from 'cli/lib/preview-sites';

vi.mock( '@studio/common/lib/remote-sites' );
const sites = vi.hoisted( () => ( { previews: { delete: vi.fn() } } ) );
vi.mock( '@studio/providers/services', () => ( { getProviderServices: () => ( { sites } ) } ) );

describe( 'Preview sites', () => {
	const token = 'mock-token';
	const siteId = 12345;

	beforeEach( () => {
		vi.clearAllMocks();
	} );

	describe( 'getLivePreviewSite', () => {
		const paid = { id: 1, isStaging: false, isPressable: false, pushNeedsUpgrade: false };

		it.each( [
			{ name: 'one paid production site', sites: [ paid ], expected: 1 },
			{ name: 'staging', sites: [ { ...paid, isStaging: true } ], expected: undefined },
			{ name: 'Pressable', sites: [ { ...paid, isPressable: true } ], expected: undefined },
			{
				name: 'not known to need a plan',
				sites: [ { ...paid, pushNeedsUpgrade: undefined } ],
				expected: 1,
			},
			{
				name: 'needs upgrade',
				sites: [ { ...paid, pushNeedsUpgrade: true } ],
				expected: undefined,
			},
			{ name: 'two paid sites', sites: [ paid, { ...paid, id: 2 } ], expected: undefined },
		] )( 'with $name', async ( { sites: connected, expected } ) => {
			vi.mocked( getRemoteSites ).mockResolvedValue(
				connected as unknown as Awaited< ReturnType< typeof getRemoteSites > >
			);
			expect( ( await getLivePreviewSite( 'local' ) )?.id ).toBe( expected );
		} );
	} );

	it( 'takes down WordPress.com previews and leaves Jurassic Ninja ones to expire', async () => {
		const snapshot = { atomicSiteId: siteId, localSiteId: 'site', date: Date.now() };
		await deleteSnapshotSite( { ...snapshot, url: 'old-preview.wp.build' }, token );
		expect( sites.previews.delete ).not.toHaveBeenCalled();

		await deleteSnapshotSite( { ...snapshot, url: 'preview-site.wpcomstaging.com' }, token );
		expect( sites.previews.delete ).toHaveBeenCalledWith( { token }, { id: siteId } );
	} );
} );
