import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchSnapshotUsage } from '@studio/common/lib/snapshots';

describe( 'fetchSnapshotUsage', () => {
	afterEach( () => {
		vi.unstubAllGlobals();
	} );

	it( 'reads WordPress.com preview usage for any account', async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			Response.json( {
				preview_sites: [ { id: 1 }, { id: 2 } ],
				preview_site_limit: 5,
				preview_sites_blocked: true,
			} )
		);
		vi.stubGlobal( 'fetch', fetchMock );

		await expect( fetchSnapshotUsage( 'account-token' ) ).resolves.toEqual( {
			siteCount: 2,
			siteLimit: 5,
			siteCreationBlocked: true,
		} );
		expect( fetchMock ).toHaveBeenCalledExactlyOnceWith(
			'https://public-api.wordpress.com/wpcom/v2/wow-funnel/pending',
			{ headers: { Authorization: 'Bearer account-token' } }
		);
	} );
} );
