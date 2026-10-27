import { readAuthToken } from '@studio/common/lib/shared-config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableReprintExporter } from 'cli/lib/api';
import { fetchSyncableSites } from 'cli/lib/sync-api';
import { pickSyncSite } from 'cli/lib/sync-site-picker';
import {
	findMatchingWpComSite,
	getReprintApiUrlForSite,
	normalizeSiteUrl,
	resolveSourceSite,
} from './pull-source';
import type { SyncSite } from '@studio/common/types/sync';

vi.mock( import( '@studio/common/lib/shared-config' ), async ( importOriginal ) => ( {
	...( await importOriginal() ),
	readAuthToken: vi.fn(),
} ) );
vi.mock( import( 'cli/lib/api' ), async ( importOriginal ) => ( {
	...( await importOriginal() ),
	enableReprintExporter: vi.fn(),
} ) );
vi.mock( import( 'cli/lib/sync-api' ), async ( importOriginal ) => ( {
	...( await importOriginal() ),
	fetchSyncableSites: vi.fn(),
} ) );
vi.mock( import( 'cli/lib/sync-site-picker' ), async ( importOriginal ) => ( {
	...( await importOriginal() ),
	pickSyncSite: vi.fn(),
} ) );

describe( 'pull source URLs', () => {
	it( 'normalizes URLs by stripping hashes and trailing slashes', () => {
		expect( normalizeSiteUrl( 'https://example.com/foo//#section' ) ).toBe(
			'https://example.com/foo'
		);
	} );

	it( 'accepts a bare domain and defaults it to https', () => {
		expect( normalizeSiteUrl( 'example.com/foo' ) ).toBe( 'https://example.com/foo' );
	} );

	it( 'strips the site export API marker from the canonical site URL', () => {
		expect( normalizeSiteUrl( 'https://example.com/?reprint-api-jetpack' ) ).toBe(
			'https://example.com/'
		);
	} );

	it( 'adds the site export API marker exactly once to the importer URL', () => {
		expect(
			getReprintApiUrlForSite( normalizeSiteUrl( 'https://example.com/?reprint-api-jetpack' ) )
		).toBe( 'https://example.com/?reprint-api-jetpack' );
	} );

	it( 'matches WordPress.com sites by normalized URL or host', () => {
		expect(
			findMatchingWpComSite(
				[ { id: 1, name: 'Example', url: 'https://example.wordpress.com/' } ],
				'https://example.wordpress.com'
			)
		).toEqual( { id: 1, name: 'Example', url: 'https://example.wordpress.com/' } );
	} );
} );

describe( 'resolveSourceSite', () => {
	const token = {
		accessToken: 'access-token',
		id: 1,
		email: 'user@example.com',
		displayName: 'User',
		expiresIn: 1209600,
		expirationTime: Date.now() + 1209600000,
	};

	function syncSite(
		over: Partial< SyncSite > & { id: number; name: string; url: string }
	): SyncSite {
		return {
			localSiteId: '',
			isStaging: false,
			isPressable: false,
			syncSupport: 'syncable',
			lastPullTimestamp: null,
			lastPushTimestamp: null,
			...over,
		};
	}

	const sites: SyncSite[] = [
		syncSite( { id: 11, name: 'One', url: 'https://one.wordpress.com' } ),
		syncSite( { id: 22, name: 'Two', url: 'https://two.wordpress.com', isStaging: true } ),
	];

	const originalIsTTY = process.stdin.isTTY;

	function setTTY( value: boolean ): void {
		Object.defineProperty( process.stdin, 'isTTY', {
			value,
			configurable: true,
		} );
	}

	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( readAuthToken ).mockResolvedValue( token );
		vi.mocked( enableReprintExporter ).mockResolvedValue( { hasPublicKey: true } );
	} );

	afterEach( () => {
		setTTY( originalIsTTY );
		vi.restoreAllMocks();
	} );

	it( 'opens the interactive picker for multiple syncable sites in a TTY and returns the chosen site', async () => {
		setTTY( true );
		vi.mocked( fetchSyncableSites ).mockResolvedValue( sites );
		vi.mocked( pickSyncSite ).mockResolvedValue( sites[ 1 ] );

		const source = await resolveSourceSite();

		expect( pickSyncSite ).toHaveBeenCalledWith( sites, expect.any( String ) );
		expect( source ).toMatchObject( {
			url: 'https://two.wordpress.com',
			exporter: { hasPublicKey: true },
			wpComSite: sites[ 1 ],
		} );
		// The exporter is enabled for the picked site only.
		expect( enableReprintExporter ).toHaveBeenCalledTimes( 1 );
		expect( enableReprintExporter ).toHaveBeenCalledWith( 22, token.accessToken, false );
	} );

	it( 'threads the exporter status of a site without a key into the resolved source', async () => {
		setTTY( true );
		vi.mocked( fetchSyncableSites ).mockResolvedValue( sites );
		vi.mocked( enableReprintExporter ).mockResolvedValue( { hasPublicKey: false } );

		const source = await resolveSourceSite( 'https://two.wordpress.com' );

		expect( source ).toMatchObject( { exporter: { hasPublicKey: false } } );
		expect( enableReprintExporter ).toHaveBeenCalledWith( 22, token.accessToken, false );
	} );

	it( 'returns null without provisioning when the user cancels the picker', async () => {
		setTTY( true );
		vi.mocked( fetchSyncableSites ).mockResolvedValue( sites );
		vi.mocked( pickSyncSite ).mockResolvedValue( undefined );

		const source = await resolveSourceSite();

		expect( source ).toBeNull();
		expect( enableReprintExporter ).not.toHaveBeenCalled();
	} );

	it( 'aborts with an error for multiple sites when not in a TTY (no picker)', async () => {
		setTTY( false );
		vi.mocked( fetchSyncableSites ).mockResolvedValue( sites );

		await expect( resolveSourceSite() ).rejects.toThrow( /Re-run with `--url/ );
		expect( pickSyncSite ).not.toHaveBeenCalled();
		expect( enableReprintExporter ).not.toHaveBeenCalled();
	} );

	it( 'auto-picks the only connected site without prompting (single-site path unchanged)', async () => {
		setTTY( true );
		vi.mocked( fetchSyncableSites ).mockResolvedValue( [ sites[ 0 ] ] );

		const source = await resolveSourceSite();

		expect( pickSyncSite ).not.toHaveBeenCalled();
		expect( source ).toMatchObject( {
			url: 'https://one.wordpress.com',
			exporter: { hasPublicKey: true },
			wpComSite: sites[ 0 ],
		} );
	} );

	it( 'errors when no syncable sites exist', async () => {
		setTTY( true );
		vi.mocked( fetchSyncableSites ).mockResolvedValue( [] );

		await expect( resolveSourceSite() ).rejects.toThrow(
			/No pullable WordPress\.com or Pressable sites/
		);
		expect( pickSyncSite ).not.toHaveBeenCalled();
	} );

	it( 'passes the full site list to the picker so non-syncable sites can be shown disabled', async () => {
		setTTY( true );
		const nonSyncable = syncSite( {
			id: 33,
			name: 'Simple',
			url: 'https://simple.wordpress.com',
			syncSupport: 'needs-transfer',
		} );
		const all = [ sites[ 0 ], nonSyncable, sites[ 1 ] ];
		vi.mocked( fetchSyncableSites ).mockResolvedValue( all );
		vi.mocked( pickSyncSite ).mockResolvedValue( sites[ 1 ] );

		const source = await resolveSourceSite();

		// pickSyncSite itself disables non-syncable entries, so it receives the
		// full list rather than a pre-filtered one.
		expect( pickSyncSite ).toHaveBeenCalledWith( all, expect.any( String ) );
		expect( source ).toMatchObject( { wpComSite: sites[ 1 ] } );
	} );

	it( 'auto-picks the only syncable site when the rest are non-syncable', async () => {
		setTTY( true );
		const nonSyncable = syncSite( {
			id: 33,
			name: 'Simple',
			url: 'https://simple.wordpress.com',
			syncSupport: 'needs-upgrade',
		} );
		vi.mocked( fetchSyncableSites ).mockResolvedValue( [ nonSyncable, sites[ 0 ] ] );

		const source = await resolveSourceSite();

		expect( pickSyncSite ).not.toHaveBeenCalled();
		expect( source ).toMatchObject( { url: 'https://one.wordpress.com', wpComSite: sites[ 0 ] } );
	} );

	it( 'enables the exporter for a syncable site matched by --url', async () => {
		setTTY( true );
		vi.mocked( fetchSyncableSites ).mockResolvedValue( sites );

		const source = await resolveSourceSite( 'https://two.wordpress.com' );

		expect( source ).toMatchObject( {
			url: 'https://two.wordpress.com',
			exporter: { hasPublicKey: true },
			wpComSite: sites[ 1 ],
		} );
		expect( enableReprintExporter ).toHaveBeenCalledWith( 22, token.accessToken, false );
		expect( pickSyncSite ).not.toHaveBeenCalled();
	} );

	it( 'rejects a needs-transfer site passed via --url with the hosting-features message', async () => {
		setTTY( true );
		vi.mocked( fetchSyncableSites ).mockResolvedValue( [
			syncSite( {
				id: 44,
				name: 'Simple',
				url: 'https://only-simple.example.com',
				syncSupport: 'needs-transfer',
			} ),
		] );

		await expect( resolveSourceSite( 'https://only-simple.example.com' ) ).rejects.toThrow(
			/hosting features to be enabled.*hosting-features\/44/
		);
		expect( enableReprintExporter ).not.toHaveBeenCalled();
	} );

	it( 'rejects a needs-upgrade site passed via --url with the plan-upgrade message', async () => {
		setTTY( true );
		vi.mocked( fetchSyncableSites ).mockResolvedValue( [
			syncSite( {
				id: 55,
				name: 'Free',
				url: 'https://free.example.com',
				syncSupport: 'needs-upgrade',
			} ),
		] );

		await expect( resolveSourceSite( 'https://free.example.com' ) ).rejects.toThrow(
			/plan with hosting features.*plans\/55/
		);
		expect( enableReprintExporter ).not.toHaveBeenCalled();
	} );

	it( 'reports the specific reason when the only site is not pullable (no --url)', async () => {
		setTTY( true );
		vi.mocked( fetchSyncableSites ).mockResolvedValue( [
			syncSite( {
				id: 66,
				name: 'Simple',
				url: 'https://lone-simple.example.com',
				syncSupport: 'needs-transfer',
			} ),
		] );

		await expect( resolveSourceSite() ).rejects.toThrow(
			/hosting features to be enabled.*hosting-features\/66/
		);
		expect( pickSyncSite ).not.toHaveBeenCalled();
		expect( enableReprintExporter ).not.toHaveBeenCalled();
	} );

	it( 'rejects a URL that is not connected to the WordPress.com account', async () => {
		setTTY( true );
		vi.mocked( fetchSyncableSites ).mockResolvedValue( sites );

		await expect( resolveSourceSite( 'https://third-party.example' ) ).rejects.toThrow(
			/not a WordPress\.com or Pressable site connected to your account/
		);
		expect( pickSyncSite ).not.toHaveBeenCalled();
		expect( enableReprintExporter ).not.toHaveBeenCalled();
	} );
} );
