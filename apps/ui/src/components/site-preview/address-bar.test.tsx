import { fireEvent, render, screen } from '@testing-library/react';
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
	onSwitchRealm = vi.fn(),
	path = '/',
	showDatabaseTab = true,
}: {
	onSwitchRealm?: Mock;
	path?: string;
	showDatabaseTab?: boolean;
} = {} ) {
	render(
		<Tooltip.Provider>
			<PreviewAddressBar
				site={ SITE }
				path={ path }
				showDatabaseTab={ showDatabaseTab }
				onSwitchRealm={ onSwitchRealm }
			/>
		</Tooltip.Provider>
	);
	return { onSwitchRealm };
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

	it( 'does not switch realms from the active segment', () => {
		const { onSwitchRealm } = renderAddressBar( { path: '/' } );

		fireEvent.click( screen.getByText( 'Example Site' ) );
		expect( onSwitchRealm ).not.toHaveBeenCalled();
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
} );
