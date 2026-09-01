import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	DATABASE_HOME_PATH,
	getPreviewRealm,
	getRealmNavigationPath,
	getRealmOpenEvent,
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
	path = '/',
	site = SITE,
	onNavigate = vi.fn< ( path: string ) => void >(),
	onSwitchRealm = vi.fn< ( realm: 'frontend' | 'admin' | 'database' ) => void >(),
}: {
	path?: string;
	site?: SiteDetails;
	onNavigate?: Mock< ( path: string ) => void >;
	onSwitchRealm?: Mock< ( realm: 'frontend' | 'admin' | 'database' ) => void >;
} = {} ) {
	const result = render(
		<PreviewAddressBar
			site={ site }
			siteUrl={ SITE_URL }
			path={ path }
			onNavigate={ onNavigate }
			onSwitchRealm={ onSwitchRealm }
		/>
	);
	return { ...result, onNavigate, onSwitchRealm };
}

describe( 'parseOmniboxInput', () => {
	it( 'returns null for empty input', () => {
		expect( parseOmniboxInput( '', SITE_URL ) ).toBeNull();
	} );

	it( 'extracts same-origin paths and rejects cross-origin urls', () => {
		expect( parseOmniboxInput( `${ SITE_URL }/wp-admin/?page=1#top`, SITE_URL ) ).toEqual( {
			type: 'path',
			path: '/wp-admin/?page=1#top',
		} );
		expect( parseOmniboxInput( 'https://example.com/about', SITE_URL ) ).toBeNull();
	} );

	it( 'normalizes paths and treats words as searches', () => {
		expect( parseOmniboxInput( 'wp-admin/plugins.php', SITE_URL ) ).toEqual( {
			type: 'path',
			path: '/wp-admin/plugins.php',
		} );
		expect( parseOmniboxInput( 'hello world', SITE_URL ) ).toEqual( {
			type: 'search',
			term: 'hello world',
		} );
	} );
} );

describe( 'preview realms', () => {
	it( 'classifies regular and auto-login paths', () => {
		expect( getPreviewRealm( '/' ) ).toBe( 'frontend' );
		expect( getPreviewRealm( '/wp-admin/' ) ).toBe( 'admin' );
		expect( getPreviewRealm( DATABASE_HOME_PATH ) ).toBe( 'database' );
		expect( getPreviewRealm( autoLoginPath( '/wp-admin/plugins.php' ) ) ).toBe( 'admin' );
	} );

	it( 'maps realms to open events', () => {
		expect( getRealmOpenEvent( 'frontend' ) ).toBe( 'studio_site_open_in_browser' );
		expect( getRealmOpenEvent( 'admin' ) ).toBe( 'studio_site_open_wp_admin' );
		expect( getRealmOpenEvent( 'database' ) ).toBe( 'studio_site_open_phpmyadmin' );
	} );

	it( 'routes admin paths through auto-login', () => {
		expect( getRealmNavigationPath( '/wp-admin/plugins.php', SITE_URL ) ).toBe(
			autoLoginPath( '/wp-admin/plugins.php' )
		);
		expect( getRealmNavigationPath( '/about/', SITE_URL ) ).toBe( '/about/' );
	} );
} );

describe( 'PreviewAddressBar', () => {
	beforeEach( () => window.localStorage.clear() );

	it( 'shows the current complete URL and follows path updates', () => {
		const { rerender } = renderAddressBar( { path: '/about/?preview=1' } );
		const input = screen.getByRole( 'textbox', { name: 'Address' } );
		expect( input ).toHaveValue( `${ SITE_URL }/about/?preview=1` );

		rerender(
			<PreviewAddressBar
				site={ SITE }
				siteUrl={ SITE_URL }
				path="/contact/"
				onNavigate={ vi.fn() }
				onSwitchRealm={ vi.fn() }
			/>
		);
		expect( input ).toHaveValue( `${ SITE_URL }/contact/` );
	} );

	it( 'selects the URL on focus', () => {
		renderAddressBar();
		const input = screen.getByRole( 'textbox', { name: 'Address' } ) as HTMLInputElement;
		fireEvent.focus( input );
		expect( input.selectionStart ).toBe( 0 );
		expect( input.selectionEnd ).toBe( input.value.length );
	} );

	it( 'navigates paths and searches submitted from the address field', () => {
		const { onNavigate } = renderAddressBar();
		const input = screen.getByRole( 'textbox', { name: 'Address' } );

		fireEvent.change( input, { target: { value: '/wp-admin/plugins.php' } } );
		fireEvent.submit( input.closest( 'form' )! );
		expect( onNavigate ).toHaveBeenLastCalledWith( autoLoginPath( '/wp-admin/plugins.php' ) );

		fireEvent.change( input, { target: { value: 'hello world' } } );
		fireEvent.submit( input.closest( 'form' )! );
		expect( onNavigate ).toHaveBeenLastCalledWith( '/?s=hello%20world' );
	} );

	it( 'does not navigate to a cross-origin URL', () => {
		const { onNavigate } = renderAddressBar();
		const input = screen.getByRole( 'textbox', { name: 'Address' } );
		fireEvent.change( input, { target: { value: 'https://example.com/' } } );
		fireEvent.submit( input.closest( 'form' )! );
		expect( onNavigate ).not.toHaveBeenCalled();
	} );

	it( 'puts the configured site icon inside the address field', () => {
		const siteIcon = 'data:image/png;base64,c2l0ZS1pY29u';
		const { container } = renderAddressBar( { site: { ...SITE, siteIcon } } );
		const input = screen.getByRole( 'textbox', { name: 'Address' } );
		expect(
			input.closest( 'form' )?.querySelector( `img[src="${ siteIcon }"]` )
		).toBeInTheDocument();
		expect( container.querySelectorAll( 'button' ) ).toHaveLength( 0 );
	} );

	it( 'changes the address icon for WP Admin and Database', () => {
		const { container, rerender } = renderAddressBar( { path: '/wp-admin/' } );
		expect( container.querySelector( '[data-realm="admin"]' ) ).toBeInTheDocument();
		expect( container.querySelector( '[data-realm="admin"] svg' ) ).toBeInTheDocument();

		rerender(
			<PreviewAddressBar
				site={ SITE }
				siteUrl={ SITE_URL }
				path={ DATABASE_HOME_PATH }
				onNavigate={ vi.fn() }
				onSwitchRealm={ vi.fn() }
			/>
		);
		expect( container.querySelector( '[data-realm="database"]' ) ).toBeInTheDocument();
	} );

	it( 'shows preview shortcuts from the address field', async () => {
		const siteIcon = 'data:image/png;base64,c2hvcnRjdXQtaWNvbg==';
		const { onSwitchRealm } = renderAddressBar( { site: { ...SITE, siteIcon } } );
		const input = screen.getByRole( 'textbox', { name: 'Address' } );
		fireEvent.click( input );

		expect( await screen.findByRole( 'button', { name: /Front end/ } ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: /WP Admin/ } ) ).toBeVisible();
		expect( document.querySelectorAll( `img[src="${ siteIcon }"]` ) ).toHaveLength( 2 );
		fireEvent.click( screen.getByRole( 'button', { name: /Database/ } ) );

		expect( onSwitchRealm ).toHaveBeenCalledWith( 'database' );
		await waitFor( () =>
			expect( screen.queryByRole( 'button', { name: /Database/ } ) ).not.toBeInTheDocument()
		);
		fireEvent.focus( input );
		expect( screen.queryByRole( 'button', { name: /Database/ } ) ).not.toBeInTheDocument();
	} );

	it( 'remembers submitted addresses per site and lists them as recent destinations', async () => {
		const { unmount } = renderAddressBar();
		const input = screen.getByRole( 'textbox', { name: 'Address' } );
		fireEvent.change( input, { target: { value: '/about/' } } );
		fireEvent.submit( input.closest( 'form' )! );
		unmount();

		renderAddressBar();
		fireEvent.click( screen.getByRole( 'textbox', { name: 'Address' } ) );
		const popup = await screen.findByRole( 'dialog', { name: 'Preview shortcuts' } );

		expect( within( popup ).getByText( 'Recent' ) ).toBeVisible();
		expect( within( popup ).getByRole( 'button', { name: `${ SITE_URL }/about/` } ) ).toBeVisible();
	} );
} );
