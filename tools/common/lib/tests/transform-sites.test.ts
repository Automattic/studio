import { transformSitesResponse } from '../sync/transform-sites';

const createRawSite = ( {
	ID,
	name,
	url,
	isWpcomStagingSite = false,
	wpcomStagingBlogIds = [],
	environmentType = 'production',
}: {
	ID: number;
	name: string;
	url?: string;
	isWpcomStagingSite?: boolean;
	wpcomStagingBlogIds?: number[];
	environmentType?: 'production' | 'staging' | 'development';
} ) => ( {
	ID,
	is_wpcom_atomic: true,
	name,
	URL: url ?? `https://${ name.toLowerCase().replace( /\s+/g, '-' ) }.example`,
	jetpack: false,
	is_deleted: false,
	is_wpcom_staging_site: isWpcomStagingSite,
	environment_type: environmentType,
	options: {
		created_at: '2026-01-01T00:00:00+00:00',
		wpcom_staging_blog_ids: wpcomStagingBlogIds,
		software_version: '6.9.4',
	},
	capabilities: {
		manage_options: true,
	},
	plan: {
		features: {
			active: [ 'staging-sites' ],
		},
		product_id: 1,
		product_name_short: 'Business',
		product_slug: 'business',
	},
} );

describe( 'transformSitesResponse', () => {
	it( 'preserves WordPress.com production and staging relationships', () => {
		const sites = transformSitesResponse( [
			createRawSite( {
				ID: 101,
				name: 'Auro Atelier',
				wpcomStagingBlogIds: [ 202 ],
			} ),
			createRawSite( {
				ID: 202,
				name: 'Auro Atelier Staging',
				isWpcomStagingSite: true,
				environmentType: 'staging',
			} ),
		] );

		expect( sites ).toHaveLength( 2 );
		expect( sites[ 0 ] ).toEqual(
			expect.objectContaining( {
				id: 101,
				isStaging: false,
				stagingSiteIds: [ 202 ],
				productionSiteId: undefined,
				isWpcomAtomic: true,
				canManageOptions: true,
				hasStagingSiteFeature: true,
			} )
		);
		expect( sites[ 1 ] ).toEqual(
			expect.objectContaining( {
				id: 202,
				isStaging: true,
				productionSiteId: 101,
				stagingSiteIds: undefined,
			} )
		);
	} );

	it( 'uses the explicit WordPress.com staging site flag', () => {
		const sites = transformSitesResponse( [
			createRawSite( {
				ID: 101,
				name: 'My Store',
				url: 'https://staging-1234-mystore.wpcomstaging.com',
				isWpcomStagingSite: true,
			} ),
		] );

		expect( sites[ 0 ] ).toEqual(
			expect.objectContaining( {
				id: 101,
				isStaging: true,
			} )
		);
	} );

	it( 'does not infer staging from a WordPress.com staging hostname', () => {
		const sites = transformSitesResponse( [
			createRawSite( {
				ID: 101,
				name: 'My Store',
				url: 'https://store.wpcomstaging.com',
				isWpcomStagingSite: false,
			} ),
		] );

		expect( sites[ 0 ] ).toEqual(
			expect.objectContaining( {
				id: 101,
				isStaging: false,
			} )
		);
	} );
} );
