import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildPreview, fetchSnapshotUsage } from '@studio/common/lib/snapshots';
import type { PushContent, RemoteSite, SitesServices } from '@studio/providers';

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

describe( 'buildPreview', () => {
	it( 'rebuilds an existing preview with a push to it, then reads its link back', async () => {
		const preview = {
			id: 7,
			name: 'preview.wpcomstaging.com',
			url: 'https://preview.wpcomstaging.com',
			shareUrl: 'https://preview.wpcomstaging.com/?share=abc',
		};
		const sites = {
			push: vi.fn(),
			previews: {
				create: vi.fn(),
				list: vi.fn().mockResolvedValue( [ preview ] ),
				delete: vi.fn(),
			},
		} as unknown as SitesServices< { token: string }, RemoteSite >;
		const content = { kind: 'archive' } as PushContent;
		const onStatus = vi.fn();

		await expect(
			buildPreview( sites, { token: 't' }, content, { siteId: 7 }, { originId: 'local' }, onStatus )
		).resolves.toBe( preview );
		expect( sites.previews!.create ).not.toHaveBeenCalled();
		expect( sites.push ).toHaveBeenCalledWith(
			{ token: 't' },
			{ id: 7, name: '' },
			content,
			{ preview: { originId: 'local' } },
			onStatus
		);
	} );
} );
