import { remoteSiteFromStored, storedFromRemoteSite } from '@studio/agent/node';
import { buildSystemPrompt } from '@studio/agent/shared/system-prompt';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { describe, expect, it, vi } from 'vitest';
import { HOSTS } from 'cli/ai/hosts';
import { getWpComSites } from 'cli/lib/api';

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
		"- Studio runs the user's local WordPress sites on this computer. Each one is a complete WordPress install in its own folder: WordPress core (`wp-includes/`, `wp-admin/`) and every installed theme and plugin (`wp-content/`) are on disk.\n- The user's WordPress.com sites are live sites, reached through the WordPress.com REST API.\n- The active site is the one the user has open in Studio."
	);
} );

it( "states each host's sites in the Environment section an external agent gets", () => {
	expect( buildSystemPrompt( { external: true, remoteHosts: HOSTS } ) ).toContain(
		"(`wp-content/`) are on disk.\n- The user's WordPress.com sites are live sites, reached through the WordPress.com REST API.\n- Studio's skills are runbooks"
	);
} );

describe( 'WordPress.com', () => {
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
		{
			name: 'says when WordPress.com does not answer',
			token: { accessToken: 'token' },
			sites: () => new Promise( () => {} ),
			listing: {
				signedIn: true,
				sites: [],
				error: 'Listing WordPress.com sites timed out after 30s',
			},
		},
	] )( '$name', async ( { token, sites, listing } ) => {
		vi.useFakeTimers();
		vi.mocked( readAuthToken ).mockResolvedValue( token as never );
		vi.mocked( getWpComSites ).mockImplementation( sites as never );

		const listed = HOSTS.wpcom.sites?.list();
		await vi.advanceTimersByTimeAsync( 30_000 );
		expect( await listed ).toEqual( listing );
		vi.useRealTimers();
	} );
} );
