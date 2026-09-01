import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
	DATABASE_HOME_PATH,
	getPreviewRealm,
	getRealmNavigationPath,
	getRealmOpenEvent,
	parseOmniboxInput,
	PreviewAddressBar,
} from './address-bar';
import type { Mock } from 'vitest';

const SITE_URL = 'http://localhost:8881';
function autoLoginPath( target: string ) {
	return `/studio-auto-login?redirect_to=${ encodeURIComponent( `${ SITE_URL }${ target }` ) }`;
}

function renderAddressBar( {
	path = '/',
	onNavigate = vi.fn< ( path: string ) => void >(),
}: {
	path?: string;
	onNavigate?: Mock< ( path: string ) => void >;
} = {} ) {
	const result = render(
		<PreviewAddressBar siteUrl={ SITE_URL } path={ path } onNavigate={ onNavigate } />
	);
	return { ...result, onNavigate };
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
	it( 'shows the current complete URL and follows path updates', () => {
		const { rerender } = renderAddressBar( { path: '/about/?preview=1' } );
		const input = screen.getByRole( 'textbox', { name: 'Address' } );
		expect( input ).toHaveValue( `${ SITE_URL }/about/?preview=1` );

		rerender( <PreviewAddressBar siteUrl={ SITE_URL } path="/contact/" onNavigate={ vi.fn() } /> );
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

	it( 'renders a plain address field without shortcuts or icon adornments', () => {
		renderAddressBar();
		const input = screen.getByRole( 'textbox', { name: 'Address' } );
		expect( input.closest( 'form' )?.querySelector( 'button, img, svg' ) ).not.toBeInTheDocument();
	} );
} );
