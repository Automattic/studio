import { fireEvent, render, screen, within } from '@testing-library/react';
import { Tooltip } from '@wordpress/ui';
import { describe, expect, it, vi } from 'vitest';
import {
	getPreviewRealm,
	getRealmNavigationPath,
	parseOmniboxInput,
	PreviewAddressBar,
} from './address-bar';
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
				anchorRef={ { current: document.body } }
				showDatabaseTab={ showDatabaseTab }
				onNavigate={ onNavigate }
				onSwitchRealm={ onSwitchRealm }
			/>
		</Tooltip.Provider>
	);
	return { onNavigate, onSwitchRealm };
}

async function openOmnibox( activeRealmTitle = 'Example Site' ) {
	// Base UI gives the trigger button `role="combobox"`, whose accessible
	// name ignores its contents — locate it by its visible realm name instead.
	fireEvent.click( screen.getByText( activeRealmTitle ) );
	return ( await screen.findByLabelText( 'Address and search' ) ) as HTMLInputElement;
}

describe( 'parseOmniboxInput', () => {
	it( 'returns null for empty input', () => {
		expect( parseOmniboxInput( '', SITE_URL ) ).toBeNull();
		expect( parseOmniboxInput( '   ', SITE_URL ) ).toBeNull();
	} );

	it( 'extracts the path from same-origin urls', () => {
		expect( parseOmniboxInput( 'http://localhost:8881/wp-admin/?page=1#top', SITE_URL ) ).toEqual( {
			type: 'path',
			path: '/wp-admin/?page=1#top',
		} );
	} );

	it( 'returns null for cross-origin urls', () => {
		expect( parseOmniboxInput( 'https://example.com/about', SITE_URL ) ).toBeNull();
	} );

	it( 'treats leading-slash input as a path', () => {
		expect( parseOmniboxInput( '/sample-page', SITE_URL ) ).toEqual( {
			type: 'path',
			path: '/sample-page',
		} );
	} );

	it( 'adds a leading slash to path-like input', () => {
		expect( parseOmniboxInput( 'wp-admin/plugins.php', SITE_URL ) ).toEqual( {
			type: 'path',
			path: '/wp-admin/plugins.php',
		} );
		expect( parseOmniboxInput( '?p=123', SITE_URL ) ).toEqual( {
			type: 'path',
			path: '/?p=123',
		} );
	} );

	it( 'treats plain words and phrases as search terms', () => {
		expect( parseOmniboxInput( 'pricing', SITE_URL ) ).toEqual( {
			type: 'search',
			term: 'pricing',
		} );
		expect( parseOmniboxInput( 'hello world', SITE_URL ) ).toEqual( {
			type: 'search',
			term: 'hello world',
		} );
	} );
} );

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
	it( 'opens with the current path prefilled and selected', async () => {
		renderAddressBar( { path: '/wp-admin/' } );

		const input = ( await openOmnibox( 'WordPress' ) ) as HTMLInputElement;

		expect( input.value ).toBe( '/wp-admin/' );
		expect( input.selectionStart ).toBe( 0 );
		expect( input.selectionEnd ).toBe( '/wp-admin/'.length );
	} );

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

	it( 'rests on the WordPress destinations and navigates a picked one via auto-login', async () => {
		const { onNavigate } = renderAddressBar( { path: '/' } );

		await openOmnibox();

		// Non-block-theme destinations: Customizer group, content group, WP
		// Admin, and the database.
		fireEvent.click( await screen.findByText( 'WP Admin' ) );

		expect( onNavigate ).toHaveBeenCalledWith( autoLoginPath( '/wp-admin/' ) );
	} );

	it( 'groups the zero state into Front end and WordPress destinations', async () => {
		renderAddressBar( { path: '/' } );

		await openOmnibox();

		// Scope to the dropdown: "WordPress" is also the WP Admin segment title.
		const list = await screen.findByRole( 'listbox' );
		expect( within( list ).getByText( 'Front end' ) ).toBeInTheDocument();
		expect( within( list ).getByText( 'WordPress' ) ).toBeInTheDocument();
		// The static front-end rows are always offered.
		expect( within( list ).getByText( 'Home' ) ).toBeInTheDocument();
		expect( within( list ).getByText( '404 page' ) ).toBeInTheDocument();
	} );

	it( 'navigates destination-free paths directly from the zero state', async () => {
		const { onNavigate } = renderAddressBar( { path: '/' } );

		await openOmnibox();
		// "Database" also appears as a (collapsed) segment title; target the
		// destination row in the popover list.
		fireEvent.click( await screen.findByRole( 'option', { name: /Database/ } ) );

		expect( onNavigate ).toHaveBeenCalledWith(
			'/phpmyadmin/index.php?route=/database/structure&db=wordpress'
		);
	} );

	it( 'navigates to a typed path on Enter', async () => {
		const { onNavigate } = renderAddressBar();

		const input = await openOmnibox();
		fireEvent.change( input, { target: { value: '/sample-page' } } );
		fireEvent.keyDown( input, { key: 'Enter' } );

		expect( onNavigate ).toHaveBeenCalledWith( '/sample-page' );
	} );

	it( 'routes typed wp-admin paths through auto-login', async () => {
		const { onNavigate } = renderAddressBar();

		const input = await openOmnibox();
		fireEvent.change( input, { target: { value: '/wp-admin/plugins.php' } } );
		fireEvent.keyDown( input, { key: 'Enter' } );

		expect( onNavigate ).toHaveBeenCalledWith( autoLoginPath( '/wp-admin/plugins.php' ) );
	} );

	it( 'matches destinations while typing', async () => {
		const { onNavigate } = renderAddressBar();

		const input = await openOmnibox();
		fireEvent.change( input, { target: { value: 'media' } } );

		fireEvent.click( await screen.findByText( 'Media Library' ) );

		expect( onNavigate ).toHaveBeenCalledWith( autoLoginPath( '/wp-admin/upload.php' ) );
	} );

	it( 'does not navigate on Enter for plain words with nothing picked', async () => {
		const { onNavigate } = renderAddressBar();

		const input = await openOmnibox();
		fireEvent.change( input, { target: { value: 'nothing' } } );
		fireEvent.keyDown( input, { key: 'Enter' } );

		expect( onNavigate ).not.toHaveBeenCalled();
	} );
} );
