import { getSyncSupport } from '@studio/common/lib/sync/sync-support';
import { vi } from 'vitest';

// Mocks for site shapes
const baseSite = {
	ID: 1,
	is_wpcom_atomic: false,
	name: 'Test Site',
	URL: 'https://test.com',
	jetpack: false,
	is_deleted: false,
	hosting_provider_guess: undefined,
	options: { created_at: '2020-01-01', wpcom_staging_blog_ids: [], software_version: '6.9.4' },
	capabilities: { manage_options: true },
	plan: {
		expired: false,
		features: { active: [ 'studio-sync' ] },
		is_free: true,
		product_id: 1,
		product_name_short: 'Free',
		product_slug: 'free-plan',
		user_is_owner: true,
	},
};

vi.mock( 'src/lib/get-ipc-api' );

describe( 'getSyncSupport', () => {
	it( 'returns "deleted" if site is deleted', () => {
		const site = { ...baseSite, is_deleted: true };
		expect( getSyncSupport( site, [] ) ).toBe( 'deleted' );
	} );

	it( 'returns "missing-permissions" if manage_options is false', () => {
		const site = { ...baseSite, capabilities: { manage_options: false } };
		expect( getSyncSupport( site, [] ) ).toBe( 'missing-permissions' );
	} );

	it( 'returns "unsupported" if site is Jetpack', () => {
		const site = {
			...baseSite,
			jetpack: true,
			is_wpcom_atomic: false,
			hosting_provider_guess: undefined,
		};
		expect( getSyncSupport( site, [] ) ).toBe( 'unsupported' );
	} );

	it( 'returns "needs-upgrade" if plan is not supported and the site is not Pressable', () => {
		const site = {
			...baseSite,
			plan: {
				expired: false,
				features: { active: [] },
				is_free: true,
				product_id: 1,
				product_name_short: 'Free',
				product_slug: 'free-plan',
				user_is_owner: true,
			},
			hosting_provider_guess: undefined,
		};
		expect( getSyncSupport( site, [] ) ).toBe( 'needs-upgrade' );
	} );

	it( 'returns "needs-transfer" if site not Atomic, Jetpack, nor Pressable', () => {
		const site = {
			...baseSite,
			plan: {
				expired: false,
				features: { active: [ 'studio-sync' ] },
				is_free: false,
				product_id: 1,
				product_name_short: 'Premium',
				product_slug: 'premium-plan',
				user_is_owner: true,
			},
			is_wpcom_atomic: false,
			jetpack: false,
		};
		expect( getSyncSupport( site, [] ) ).toBe( 'needs-transfer' );
	} );

	it( 'returns "already-connected" if site ID is in connectedSiteIds', () => {
		const site = { ...baseSite, ID: 42, is_wpcom_atomic: true };
		expect( getSyncSupport( site, [ 42 ] ) ).toBe( 'already-connected' );
	} );

	it( 'returns "syncable" for Atomic site', () => {
		const site = { ...baseSite, is_wpcom_atomic: true };
		expect( getSyncSupport( site, [] ) ).toBe( 'syncable' );
	} );

	it( 'returns "syncable" for Pressable site', () => {
		const site = { ...baseSite, hosting_provider_guess: 'pressable' };
		expect( getSyncSupport( site, [] ) ).toBe( 'syncable' );
	} );
} );
