import { describe, it, expect } from 'vitest';
import { transformSitesResponse } from '../transform-sites';

// WordPress.com only returns options.software_version for Atomic/Jetpack
// sites. Simple sites — which includes Business plans that have not yet been
// transferred to Atomic, plus Free/Personal plans — omit it entirely.
function simpleBusinessSite() {
	return {
		ID: 1,
		name: 'Simple Business',
		URL: 'https://simplebusiness.wordpress.com',
		is_wpcom_atomic: false,
		jetpack: false,
		is_deleted: false,
		is_a8c: false,
		hosting_provider_guess: 'automattic',
		capabilities: { manage_options: true },
		plan: {
			features: { active: [ 'studio-sync' ] },
			product_id: 1008,
			product_name_short: 'Business',
			product_slug: 'business-bundle',
		},
		options: { created_at: '2021-11-17T16:23:55+00:00', wpcom_staging_blog_ids: [] },
	};
}

function freeSite() {
	return {
		...simpleBusinessSite(),
		ID: 2,
		name: 'Free',
		URL: 'https://free.wordpress.com',
		plan: {
			features: { active: [] as string[] },
			product_id: 1,
			product_name_short: 'Free',
			product_slug: 'free_plan',
			is_free: true,
		},
	};
}

function atomicSite() {
	return {
		ID: 3,
		name: 'Atomic',
		URL: 'https://atomic.wordpress.com',
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
		options: {
			created_at: '2021-11-17T16:23:55+00:00',
			wpcom_staging_blog_ids: [],
			software_version: '6.5',
		},
	};
}

describe( 'transformSitesResponse', () => {
	it( 'retains Simple sites whose options omit software_version and classifies them', () => {
		const result = transformSitesResponse( [ simpleBusinessSite(), freeSite() ] );

		expect( result ).toHaveLength( 2 );
		expect( result.find( ( s ) => s.id === 1 )?.syncSupport ).toBe( 'needs-transfer' );
		expect( result.find( ( s ) => s.id === 2 )?.syncSupport ).toBe( 'needs-upgrade' );
	} );

	it( 'reports software_version as wpVersion when present, undefined when omitted', () => {
		const result = transformSitesResponse( [ atomicSite(), simpleBusinessSite() ] );

		expect( result.find( ( s ) => s.id === 3 )?.wpVersion ).toBe( '6.5' );
		expect( result.find( ( s ) => s.id === 1 )?.wpVersion ).toBeUndefined();
	} );
} );
