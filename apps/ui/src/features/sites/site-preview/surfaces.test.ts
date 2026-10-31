import { describe, expect, it } from 'vitest';
import {
	aimMountedSurface,
	createPreviewSurface,
	getFrameKey,
	getSafePath,
	getSurfaceKey,
	getSurfaceUrl,
	isPageSurface,
	patchMountedSurface,
	type MountedSurfaces,
} from './surfaces';

const SITE_URL = 'http://localhost:8881';

function mounted( byKey: MountedSurfaces[ 'byKey' ] ): MountedSurfaces {
	return { siteId: 'site-1', byKey };
}

describe( 'getSurfaceKey', () => {
	it( 'keeps the front end and WP Admin on one surface', () => {
		expect( getSurfaceKey( 'frontend' ) ).toBe( 'site' );
		expect( getSurfaceKey( 'admin' ) ).toBe( 'site' );
		expect( getSurfaceKey( 'database' ) ).toBe( 'database' );
		expect( getSurfaceKey( 'design' ) ).toBe( 'design' );
	} );

	it( 'gives a headless site’s frontend app a page surface of its own', () => {
		expect( getSurfaceKey( 'frontend-app' ) ).toBe( 'app' );
		expect( isPageSurface( 'app' ) ).toBe( true );
		expect( isPageSurface( 'site' ) ).toBe( true );
		expect( isPageSurface( 'database' ) ).toBe( false );
		expect( isPageSurface( 'design' ) ).toBe( false );
	} );
} );

describe( 'getSurfaceUrl', () => {
	const FRONTEND_URL = 'http://localhost:3000';

	it( 'loads site paths on the site and frontend paths on the frontend origin', () => {
		expect( getSurfaceUrl( 'site', '/about/', SITE_URL, FRONTEND_URL ) ).toBe(
			`${ SITE_URL }/about/`
		);
		expect( getSurfaceUrl( 'app', '/about/', SITE_URL, FRONTEND_URL ) ).toBe(
			`${ FRONTEND_URL }/about/`
		);
		expect( getSurfaceUrl( 'app', '/', SITE_URL ) ).toBe( `${ SITE_URL }/` );
	} );

	it( 'keeps absolute urls, so a surface left on the other origin stays put', () => {
		expect( getSurfaceUrl( 'app', `${ FRONTEND_URL }/blog/`, SITE_URL, FRONTEND_URL ) ).toBe(
			`${ FRONTEND_URL }/blog/`
		);
		expect( getSurfaceUrl( 'app', `${ SITE_URL }/wp-admin/`, SITE_URL, FRONTEND_URL ) ).toBe(
			`${ SITE_URL }/wp-admin/`
		);
		expect( getSurfaceUrl( 'site', `${ FRONTEND_URL }/`, SITE_URL, FRONTEND_URL ) ).toBe(
			`${ FRONTEND_URL }/`
		);
	} );
} );

describe( 'getSafePath', () => {
	it( 'falls back to the root for blank or missing paths', () => {
		expect( getSafePath( '/about' ) ).toBe( '/about' );
		expect( getSafePath( '  ' ) ).toBe( '/' );
		expect( getSafePath( undefined ) ).toBe( '/' );
	} );
} );

describe( 'getFrameKey', () => {
	it( 'changes on a host reload and on a reload command, not on other commands', () => {
		const surface = createPreviewSurface( '/about', 0 );
		const key = getFrameKey( SITE_URL, surface );
		expect( getFrameKey( SITE_URL, { ...surface, reloadNonce: 1 } ) ).not.toBe( key );
		expect( getFrameKey( SITE_URL, { ...surface, reloadCommandId: 3 } ) ).not.toBe( key );
		expect( getFrameKey( SITE_URL, { ...surface, browserCommand: { id: 4, type: 'back' } } ) ).toBe(
			key
		);
	} );
} );

describe( 'patchMountedSurface', () => {
	it( 'patches a mounted surface and keeps the same state when nothing changes', () => {
		const current = mounted( { site: createPreviewSurface( '/', 0 ) } );

		expect( patchMountedSurface( current, 'site', { path: '/' } ) ).toBe( current );
		expect( patchMountedSurface( current, 'database', { path: '/x' } ) ).toBe( current );
		expect( patchMountedSurface( current, 'site', { path: '/about' } ).byKey.site?.path ).toBe(
			'/about'
		);
	} );
} );

describe( 'aimMountedSurface', () => {
	it( 'mounts a new surface level with the host nonce and leaves the other one where it was', () => {
		const site = { ...createPreviewSurface( '/about', 0 ), reloadNonce: 2 };
		const current = mounted( { site } );

		const next = aimMountedSurface( current, 'site-1', 'database', '/phpmyadmin/', 5 );

		expect( next.byKey.site ).toBe( site );
		expect( next.byKey.database ).toEqual( createPreviewSurface( '/phpmyadmin/', 5 ) );
	} );

	it( 'retargets the active surface without touching its reload nonce', () => {
		const current = mounted( { site: createPreviewSurface( '/', 1 ) } );

		expect( aimMountedSurface( current, 'site-1', 'site', '/', 3 ) ).toBe( current );
		expect( aimMountedSurface( current, 'site-1', 'site', '/about', 3 ).byKey.site ).toMatchObject(
			{
				path: '/about',
				reloadNonce: 1,
			}
		);
	} );

	it( "replaces the previous site's surfaces", () => {
		const current = mounted( {
			site: createPreviewSurface( '/', 0 ),
			database: createPreviewSurface( '/phpmyadmin/', 0 ),
		} );

		expect( aimMountedSurface( current, 'site-2', 'site', '/', 0 ) ).toEqual( {
			siteId: 'site-2',
			byKey: { site: createPreviewSurface( '/', 0 ) },
		} );
	} );
} );
