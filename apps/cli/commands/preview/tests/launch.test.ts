import { getPreviewLaunchUrl } from 'cli/commands/preview/launch';
import { wpcomPreviews } from 'cli/lib/preview-sites';
import { getSnapshotsFromConfig } from 'cli/lib/snapshots';

vi.mock( 'cli/lib/wpcom-auth', () => ( {
	requireAuthToken: vi.fn().mockResolvedValue( { id: 1, accessToken: 'token' } ),
} ) );
vi.mock( 'cli/lib/preview-sites', () => ( { wpcomPreviews: { list: vi.fn() } } ) );
vi.mock( 'cli/lib/snapshots', () => ( { getSnapshotsFromConfig: vi.fn() } ) );

describe( 'getPreviewLaunchUrl', () => {
	const launchUrl = 'https://wordpress.com/setup/launch-site?siteSlug=preview.wpcomstaging.com';

	beforeEach( () => {
		vi.mocked( getSnapshotsFromConfig ).mockResolvedValue( [
			{ url: 'preview.wpcomstaging.com', atomicSiteId: 7, localSiteId: 'one', date: 2000 },
		] );
	} );

	it.each( [
		[ 'the link WordPress.com gives for a standing preview', { launchUrl }, launchUrl ],
		[ 'no link for a preview of changes to a live site', { liveSiteId: 9 }, null ],
		[ 'no link for a preview that was bought or ended', undefined, null ],
	] )( 'returns %s', async ( _, standing, expected ) => {
		vi.mocked( wpcomPreviews.list ).mockResolvedValue(
			standing ? [ { id: 7, name: '', url: '', ...standing } ] : []
		);
		const result = getPreviewLaunchUrl( 'preview.wpcomstaging.com' );
		if ( expected ) {
			await expect( result ).resolves.toBe( expected );
		} else {
			await expect( result ).rejects.toMatchObject( { code: 'not_launchable' } );
		}
	} );
} );
