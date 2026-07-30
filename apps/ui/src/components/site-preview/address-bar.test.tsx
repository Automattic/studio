import { fireEvent, render, screen, within } from '@testing-library/react';
import { Tooltip } from '@wordpress/ui';
import { describe, expect, it, vi } from 'vitest';
import { getPreviewRealm, getRealmNavigationPath, PreviewAddressBar } from './address-bar';
import type { SiteDetails } from '@/data/core';
import type { Mock } from 'vitest';

const SITE_URL = 'http://localhost:8881';

const SITE = {
	id: 'site-1',
	name: 'Example Site',
	path: '/Users/example/Studio/example-site',
	port: 8881,
	running: true,
	phpVersion: '8.3',
} as SiteDetails;

function autoLoginPath( target: string ) {
	return `/studio-auto-login?redirect_to=${ encodeURIComponent( `${ SITE_URL }${ target }` ) }`;
}

function renderAddressBar( {
	onNavigate = vi.fn(),
	onSwitchRealm = vi.fn(),
	path = '/',
	showDatabaseTab = true,
}: {
	onNavigate?: Mock;
	onSwitchRealm?: Mock;
	path?: string;
	showDatabaseTab?: boolean;
} = {} ) {
	render(
		<Tooltip.Provider>
			<PreviewAddressBar
				site={ SITE }
				siteUrl={ SITE_URL }
				path={ path }
				showDatabaseTab={ showDatabaseTab }
				onNavigate={ onNavigate }
				onSwitchRealm={ onSwitchRealm }
			/>
		</Tooltip.Provider>
	);
	return { onNavigate, onSwitchRealm };
}

async function openDestinationsMenu( activeRealmTitle = 'Example Site' ) {
	fireEvent.click( screen.getByText( activeRealmTitle ) );
	return await screen.findByRole( 'menu' );
}

describe( 'getPreviewRealm', () => {
	it( 'classifies front-end paths', () => {
		expect( getPreviewRealm( '/' ) ).toBe( 'frontend' );
		expect( getPreviewRealm( '/about/?preview=1' ) ).toBe( 'frontend' );
	} );

	it( 'classifies wp-admin paths', () => {
		expect( getPreviewRealm( '/wp-admin/' ) ).toBe( 'admin' );
		expect( getPreviewRealm( '/wp-admin/site-editor.php?path=%2Fpatterns' ) ).toBe( 'admin' );
	} );

	it( 'classifies phpMyAdmin paths', () => {
		expect( getPreviewRealm( '/phpmyadmin/index.php?route=/database/structure' ) ).toBe(
			'database'
		);
	} );

	it( 'classifies auto-login hops by their redirect target', () => {
		expect( getPreviewRealm( autoLoginPath( '/wp-admin/plugins.php' ) ) ).toBe( 'admin' );
		expect( getPreviewRealm( autoLoginPath( '/phpmyadmin/index.php' ) ) ).toBe( 'database' );
		expect( getPreviewRealm( autoLoginPath( '/about/' ) ) ).toBe( 'frontend' );
	} );
} );

describe( 'getRealmNavigationPath', () => {
	it( 'passes non-admin paths through untouched', () => {
		expect( getRealmNavigationPath( '/about/', SITE_URL ) ).toBe( '/about/' );
		expect( getRealmNavigationPath( '/phpmyadmin/index.php', SITE_URL ) ).toBe(
			'/phpmyadmin/index.php'
		);
	} );

	it( 'routes wp-admin paths through auto-login', () => {
		expect( getRealmNavigationPath( '/wp-admin/plugins.php', SITE_URL ) ).toBe(
			autoLoginPath( '/wp-admin/plugins.php' )
		);
	} );
} );

describe( 'PreviewAddressBar', () => {
	it( 'shows one segment per realm and switches realms from inactive segments', () => {
		const { onSwitchRealm } = renderAddressBar( { path: '/' } );

		// The front end is active (it carries the site name); the other two
		// realms render as labelled icon segments.
		fireEvent.click( screen.getByRole( 'button', { name: 'View WP Admin' } ) );
		expect( onSwitchRealm ).toHaveBeenCalledWith( 'admin' );

		fireEvent.click( screen.getByRole( 'button', { name: 'View database' } ) );
		expect( onSwitchRealm ).toHaveBeenCalledWith( 'database' );

		expect(
			screen.queryByRole( 'button', { name: 'View site front end' } )
		).not.toBeInTheDocument();
	} );

	it( 'hides the database segment when the database tab is turned off', () => {
		renderAddressBar( { path: '/', showDatabaseTab: false } );

		expect( screen.getByRole( 'button', { name: 'View WP Admin' } ) ).toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'View database' } ) ).not.toBeInTheDocument();
	} );

	it( 'marks the segment matching the current path as active', () => {
		renderAddressBar( { path: '/wp-admin/plugins.php' } );

		expect( screen.getByRole( 'button', { name: 'View site front end' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'View database' } ) ).toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'View WP Admin' } ) ).not.toBeInTheDocument();
	} );

	it( 'groups the destinations menu into Front end and WordPress', async () => {
		renderAddressBar( { path: '/' } );

		const menu = await openDestinationsMenu();

		expect( within( menu ).getByText( 'Front end' ) ).toBeInTheDocument();
		expect( within( menu ).getByText( 'WordPress' ) ).toBeInTheDocument();
		expect( within( menu ).getByRole( 'menuitem', { name: /Home/ } ) ).toBeInTheDocument();
		expect( within( menu ).getByRole( 'menuitem', { name: /404 page/ } ) ).toBeInTheDocument();
	} );

	it( 'navigates a picked WordPress destination via auto-login', async () => {
		const { onNavigate } = renderAddressBar( { path: '/' } );

		const menu = await openDestinationsMenu();
		fireEvent.click( within( menu ).getByRole( 'menuitem', { name: /Media Library/ } ) );

		expect( onNavigate ).toHaveBeenCalledWith( autoLoginPath( '/wp-admin/upload.php' ) );
	} );

	it( 'marks the destination matching the current path as current', async () => {
		renderAddressBar( { path: '/wp-admin/upload.php' } );

		const menu = await openDestinationsMenu( 'WordPress' );

		expect( within( menu ).getByRole( 'menuitem', { name: /Media Library/ } ) ).toHaveAttribute(
			'aria-current',
			'page'
		);
		expect( within( menu ).getByRole( 'menuitem', { name: /Home/ } ) ).not.toHaveAttribute(
			'aria-current'
		);
	} );

	it( 'offers no WP Admin or Database rows — their segments cover those realms', async () => {
		renderAddressBar( { path: '/' } );

		const menu = await openDestinationsMenu();

		expect(
			within( menu ).queryByRole( 'menuitem', { name: /WP Admin/ } )
		).not.toBeInTheDocument();
		expect(
			within( menu ).queryByRole( 'menuitem', { name: /Database/ } )
		).not.toBeInTheDocument();
	} );
} );
