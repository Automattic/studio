import { buildSupplementalSyncSite } from 'src/modules/sync/lib/build-supplemental-sync-site';
import type { SitesEndpointSite, SyncSite } from '@studio/common/types/sync';

// A rest/v1.1 /sites/{id} response for a Pressable site: the endpoint omits
// the wpcom-only fields /me/sites is decorated with (hosting_provider_guess,
// environment_type), even when explicitly requested.
const v11SiteResponse = ( overrides: Partial< SitesEndpointSite > = {} ): SitesEndpointSite => ( {
	ID: 1,
	is_wpcom_atomic: false,
	name: 'Test Site',
	URL: 'https://test.com',
	jetpack: true,
	is_deleted: false,
	options: {
		created_at: '2024-01-01',
		wpcom_staging_blog_ids: [],
		software_version: '6.9.4',
	},
	capabilities: { manage_options: true },
	...overrides,
} );

const storedSite = ( overrides: Partial< SyncSite > = {} ): SyncSite => ( {
	id: 1,
	localSiteId: 'local-site-id',
	name: 'Test Site',
	url: 'https://test.com',
	isStaging: false,
	isPressable: true,
	environmentType: 'production',
	syncSupport: 'already-connected',
	lastPullTimestamp: null,
	lastPushTimestamp: null,
	...overrides,
} );

describe( 'buildSupplementalSyncSite', () => {
	describe( 'when the response lacks hosting_provider_guess (STU-1944)', () => {
		test( 'preserves Pressable support from the stored connected site', () => {
			const result = buildSupplementalSyncSite( v11SiteResponse(), storedSite(), [ 1 ] );

			expect( result.isPressable ).toBe( true );
			expect( result.syncSupport ).toBe( 'already-connected' );
		} );

		test( 'still classifies a stored non-Pressable Jetpack site as unsupported', () => {
			const result = buildSupplementalSyncSite(
				v11SiteResponse(),
				storedSite( { isPressable: false } ),
				[ 1 ]
			);

			expect( result.isPressable ).toBe( false );
			expect( result.syncSupport ).toBe( 'unsupported' );
		} );

		test( 'still marks a stored Pressable site deleted when the response says so', () => {
			const result = buildSupplementalSyncSite(
				v11SiteResponse( { is_deleted: true } ),
				storedSite(),
				[ 1 ]
			);

			expect( result.syncSupport ).toBe( 'deleted' );
		} );

		test( 'still detects lost permissions on a stored Pressable site', () => {
			const result = buildSupplementalSyncSite(
				v11SiteResponse( { capabilities: { manage_options: false } } ),
				storedSite(),
				[ 1 ]
			);

			expect( result.syncSupport ).toBe( 'missing-permissions' );
		} );
	} );

	describe( 'when the response lacks environment_type', () => {
		test( 'preserves the stored staging state', () => {
			const result = buildSupplementalSyncSite(
				v11SiteResponse(),
				storedSite( { isStaging: true, environmentType: 'staging' } ),
				[ 1 ]
			);

			expect( result.isStaging ).toBe( true );
			expect( result.environmentType ).toBe( 'staging' );
		} );
	} );

	describe( 'when the response includes provider metadata', () => {
		test( 'uses the response over the stored site', () => {
			const result = buildSupplementalSyncSite(
				v11SiteResponse( { hosting_provider_guess: 'pressable', environment_type: 'production' } ),
				storedSite( { isPressable: false, isStaging: true, environmentType: 'staging' } ),
				[ 1 ]
			);

			expect( result.isPressable ).toBe( true );
			expect( result.syncSupport ).toBe( 'already-connected' );
			expect( result.isStaging ).toBe( false );
			expect( result.environmentType ).toBe( 'production' );
		} );
	} );

	describe( 'without a stored connected site', () => {
		test( 'classifies from the response alone', () => {
			const result = buildSupplementalSyncSite( v11SiteResponse(), undefined, [] );

			expect( result.isPressable ).toBe( false );
			expect( result.syncSupport ).toBe( 'unsupported' );
		} );
	} );
} );
