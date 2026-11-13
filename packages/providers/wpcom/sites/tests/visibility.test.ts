import { beforeEach, describe, expect, it, vi } from 'vitest';
import { wpcomClient } from '../../api';
import { getWpcomSiteVisibility, setWpcomSiteVisibility } from '../visibility';

vi.mock( '../../api' );
const get = vi.fn();
const post = vi.fn();
let settings: Record< string, number >;
let site: { URL: string; launch_status: string; jetpack: boolean; is_wpcom_atomic: boolean };
beforeEach( () => {
	vi.clearAllMocks();
	settings = { blog_public: 1, wpcom_coming_soon: 0, wpcom_public_coming_soon: 0 };
	site = {
		URL: 'https://example.blog',
		launch_status: 'launched',
		jetpack: true,
		is_wpcom_atomic: true,
	};
	vi.mocked( wpcomClient ).mockReturnValue( { req: { get, post } } as unknown as ReturnType<
		typeof wpcomClient
	> );
	get.mockImplementation( async ( { path } ) =>
		path.endsWith( '/settings' ) ? { settings: { ...settings } } : { ...site }
	);
	post.mockImplementation( async ( { path, body } ) => {
		if ( path.endsWith( '/launch' ) ) site.launch_status = 'launched';
		else Object.assign( settings, body );
		return {};
	} );
} );

describe( 'WordPress.com visibility', () => {
	it.each( [ 'wpcom_coming_soon', 'wpcom_public_coming_soon' ] )(
		'reads the %s holding-page setting',
		async ( key ) => {
			settings[ key ] = 1;
			expect( await getWpcomSiteVisibility( 'token', 42 ) ).toMatchObject( {
				visibility: 'coming-soon',
				url: site.URL,
			} );
		}
	);
	it( 'reads an unlaunched site as coming soon, while retaining explicitly private sites', async () => {
		site.launch_status = 'unlaunched';
		expect( ( await getWpcomSiteVisibility( 'token', 42 ) ).visibility ).toBe( 'coming-soon' );
		settings.blog_public = -1;
		expect( ( await getWpcomSiteVisibility( 'token', 42 ) ).visibility ).toBe( 'private' );
	} );
	it( 'enables coming soon without relaunching or changing unrelated settings', async () => {
		const result = await setWpcomSiteVisibility( 'token', 42, 'coming-soon' );
		expect( result.visibility ).toBe( 'coming-soon' );
		expect( post ).toHaveBeenCalledExactlyOnceWith( {
			path: '/sites/42/settings',
			apiVersion: '1.4',
			body: { blog_public: 0, wpcom_public_coming_soon: 1, wpcom_coming_soon: 0 },
		} );
	} );
	it( 'launches an unlaunched site before making it public and confirms the result', async () => {
		site.launch_status = 'unlaunched';
		settings.wpcom_coming_soon = 1;
		expect( await setWpcomSiteVisibility( 'token', 42, 'public' ) ).toMatchObject( {
			visibility: 'public',
			launchStatus: 'launched',
		} );
		expect( post.mock.calls.map( ( [ request ] ) => request.path ) ).toEqual( [
			'/sites/42/launch',
			'/sites/42/settings',
		] );
		expect( post.mock.calls[ 1 ][ 0 ].body ).toEqual( {
			blog_public: 1,
			wpcom_public_coming_soon: 0,
			wpcom_coming_soon: 0,
		} );
	} );
	it( 'does not change settings when launch fails', async () => {
		site.launch_status = 'unlaunched';
		post.mockRejectedValueOnce( new Error( 'Launch failed' ) );
		await expect( setWpcomSiteVisibility( 'token', 42, 'public' ) ).rejects.toThrow(
			'Launch failed'
		);
		expect( post ).toHaveBeenCalledTimes( 1 );
	} );
	it( 'does not report success until the setting is confirmed', async () => {
		post.mockResolvedValue( {} );
		await expect( setWpcomSiteVisibility( 'token', 42, 'coming-soon' ) ).rejects.toThrow(
			'hasn’t confirmed'
		);
	} );
	it( 'preserves search-engine preferences when public visibility is unchanged', async () => {
		settings.blog_public = 0;
		expect( ( await setWpcomSiteVisibility( 'token', 42, 'public' ) ).visibility ).toBe( 'public' );
		expect( post ).not.toHaveBeenCalled();
	} );
	it( 'rejects unsupported sites and invalid inputs before writing', async () => {
		site.is_wpcom_atomic = false;
		await expect( setWpcomSiteVisibility( 'token', 42, 'coming-soon' ) ).rejects.toThrow(
			'only available'
		);
		await expect( getWpcomSiteVisibility( 'token', -1 ) ).rejects.toThrow();
		expect( post ).not.toHaveBeenCalled();
	} );
} );
