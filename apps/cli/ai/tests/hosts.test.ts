import { remoteSiteFromStored, storedFromRemoteSite } from '@studio/agent/node';
import { buildSystemPrompt } from '@studio/agent/node/system-prompt';
import { getConnectedWpcomSitesForLocalSite } from '@studio/common/lib/connected-sites';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { fetchSyncableSites } from '@studio/common/lib/sync/sync-api';
import { describe, expect, it, vi } from 'vitest';
import { HOSTS } from 'cli/ai/hosts';
import { getWpComSites } from 'cli/lib/api';

vi.mock( '@studio/common/lib/connected-sites', () => ( {
	getConnectedWpcomSitesForLocalSite: vi.fn(),
} ) );
vi.mock( '@studio/common/lib/sync/sync-api', () => ( { fetchSyncableSites: vi.fn() } ) );
vi.mock( '@studio/common/lib/shared-config', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('@studio/common/lib/shared-config') >() ),
	readAuthToken: vi.fn(),
} ) );
vi.mock( 'cli/lib/api', () => ( { getWpComSites: vi.fn() } ) );

describe( 'stored site selections', () => {
	it.each( [
		{
			name: 'a WordPress.com site',
			stored: { remote: true, wpcomSiteId: 123 },
			remote: { host: 'wpcom', id: 123 },
			written: { remote: true, wpcomSiteId: 123 },
		},
		{ name: 'a local site', stored: {}, remote: undefined, written: {} },
		{
			name: 'a local site an older session marked',
			stored: { remote: false },
			remote: undefined,
			written: {},
		},
		{
			name: 'a remote mark without a site id',
			stored: { remote: true },
			remote: undefined,
			written: {},
		},
	] )( 'reads and writes $name', ( { stored, remote, written } ) => {
		expect( remoteSiteFromStored( stored ) ).toEqual( remote );
		expect( storedFromRemoteSite( remoteSiteFromStored( stored ) ) ).toEqual( written );
	} );
} );

it( "states each host's sites in the Environment section as before hosts", () => {
	expect( buildSystemPrompt( { remoteHosts: HOSTS } ) ).toContain(
		"- Studio runs the user's local WordPress sites on this computer. Each one is a complete WordPress install in its own folder: WordPress core (`wp-includes/`, `wp-admin/`) and every installed theme and plugin (`wp-content/`) are on disk.\n- The user's WordPress.com sites are live sites, reached through the WordPress.com REST API.\n- A Spacefast space holds a static copy of a local site: its pages, styles and media as files, with no WordPress behind them.\n- The active site is the one the user has open in Studio."
	);
} );

it( "states each host's sites in the Environment section an external agent gets", () => {
	expect( buildSystemPrompt( { external: true, remoteHosts: HOSTS } ) ).toContain(
		"(`wp-content/`) are on disk.\n- The user's WordPress.com sites are live sites, reached through the WordPress.com REST API.\n- A Spacefast space holds a static copy of a local site: its pages, styles and media as files, with no WordPress behind them.\n- Studio's skills are runbooks"
	);
} );

describe( 'WordPress.com', () => {
	it.each( [
		{ signedIn: true, expected: { signedIn: true, targets: [ 'already-connected' ] } },
		{ signedIn: false, expected: { signedIn: false, targets: [] } },
	] )(
		'lists the sites connected to a local site (signed in: $signedIn)',
		async ( { signedIn, expected } ) => {
			const site = {
				id: 111,
				localSiteId: '',
				name: 'My Production Site',
				url: 'https://myprod.wordpress.com',
				isStaging: false,
				isPressable: false,
				environmentType: 'production',
				syncSupport: 'syncable' as const,
				lastPullTimestamp: null,
				lastPushTimestamp: null,
			};
			vi.mocked( getConnectedWpcomSitesForLocalSite ).mockResolvedValue( [
				{ ...site, localSiteId: 'site-123', name: 'Name at connect time' },
			] );
			vi.mocked( readAuthToken ).mockResolvedValue(
				( signedIn ? { accessToken: 'token' } : null ) as never
			);
			vi.mocked( fetchSyncableSites ).mockResolvedValue( [ site ] );

			const listing = await HOSTS.wpcom.targets( { id: 'site-123', path: '/sites/my-site' } );

			expect( {
				signedIn: listing.signedIn,
				targets: listing.targets.map( ( target ) => target.syncSupport ),
			} ).toEqual( expected );
			expect( HOSTS.wpcom.publishes ).toContain( 'Pressable' );
			if ( signedIn ) {
				expect( getConnectedWpcomSitesForLocalSite ).toHaveBeenCalledWith( 'site-123' );
				expect( listing.targets[ 0 ] ).toMatchObject( {
					id: 111,
					name: 'My Production Site',
					url: 'https://myprod.wordpress.com',
				} );
			}
		}
	);

	it.each( [
		{
			name: 'lists the sites the login reaches',
			token: { accessToken: 'token' },
			sites: async () => [ { id: 111, name: 'Prod', url: 'https://prod.wordpress.com' } ],
			listing: {
				signedIn: true,
				sites: [ { id: 111, name: 'Prod', url: 'https://prod.wordpress.com' } ],
			},
		},
		{
			name: 'says when the user is not logged in',
			token: null,
			sites: async () => [],
			listing: { signedIn: false, sites: [] },
		},
		{
			name: 'says why WordPress.com could not be reached',
			token: { accessToken: 'token' },
			sites: async () => {
				throw new Error( 'Failed to fetch' );
			},
			listing: { signedIn: true, sites: [], error: 'Failed to fetch' },
		},
	] )( '$name', async ( { token, sites, listing } ) => {
		vi.mocked( readAuthToken ).mockResolvedValue( token as never );
		vi.mocked( getWpComSites ).mockImplementation( sites as never );

		expect( await HOSTS.wpcom.sites?.list() ).toEqual( listing );
	} );
} );
