import { DESIGN_SYSTEM_PREVIEW_PATH } from '@studio/agent/protocol/chat-artifacts';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	DATABASE_HOME_PATH,
	getFrontendAppRelativePath,
	getPathFromPreviewUrl,
	getPreviewLocationFromUrl,
	getPreviewRealm,
	getRealmNavigationPath,
	getRealmOpenEvent,
	parseOmniboxInput,
	PreviewAddressBar,
	toFrontendAppPath,
	type PreviewRealm,
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
	remote = false,
	site = SITE,
	onNavigate = vi.fn< ( path: string ) => void >(),
	onSwitchRealm = vi.fn< ( realm: PreviewRealm ) => void >(),
}: {
	path?: string;
	remote?: boolean;
	site?: SiteDetails;
	onNavigate?: Mock< ( path: string ) => void >;
	onSwitchRealm?: Mock< ( realm: PreviewRealm ) => void >;
} = {} ) {
	const result = render(
		<PreviewAddressBar
			site={ site }
			siteUrl={ SITE_URL }
			path={ path }
			remote={ remote }
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
		expect( parseOmniboxInput( '//example.com/', SITE_URL ) ).toBeNull();
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

	it( 'accepts a headless site’s frontend addresses and resolves paths typed in it', () => {
		const frontendUrl = 'http://localhost:3000';
		expect( parseOmniboxInput( 'http://localhost:3000/blog', SITE_URL, { frontendUrl } ) ).toEqual(
			{ type: 'path', path: 'http://localhost:3000/blog' }
		);
		const inApp = { frontendUrl, inFrontendApp: true };
		expect( parseOmniboxInput( 'about/', SITE_URL, inApp ) ).toEqual( {
			type: 'path',
			path: 'http://localhost:3000/about/',
		} );
		expect( parseOmniboxInput( '/wp-admin/', SITE_URL, inApp ) ).toEqual( {
			type: 'path',
			path: '/wp-admin/',
		} );
		expect( parseOmniboxInput( '/about/', SITE_URL, { frontendUrl } ) ).toEqual( {
			type: 'path',
			path: '/about/',
		} );
	} );
} );

describe( 'getPathFromPreviewUrl', () => {
	it( 'extracts the path, search, and hash for same-origin urls', () => {
		expect(
			getPathFromPreviewUrl( 'http://localhost:8881/wp-admin/?page=1#top', 'http://localhost:8881' )
		).toBe( '/wp-admin/?page=1#top' );
	} );

	it( 'returns null for cross-origin or invalid urls', () => {
		expect( getPathFromPreviewUrl( 'https://example.com/about', 'http://localhost:8881' ) ).toBe(
			null
		);
		expect( getPathFromPreviewUrl( 'not-a-url', 'http://localhost:8881' ) ).toBe( null );
	} );
} );

describe( 'preview realms', () => {
	it( 'classifies regular and auto-login paths', () => {
		expect( getPreviewRealm( '/' ) ).toBe( 'frontend' );
		expect( getPreviewRealm( '/wp-admin/' ) ).toBe( 'admin' );
		expect( getPreviewRealm( DATABASE_HOME_PATH ) ).toBe( 'database' );
		expect( getPreviewRealm( autoLoginPath( '/wp-admin/plugins.php' ) ) ).toBe( 'admin' );
		expect( getPreviewRealm( DESIGN_SYSTEM_PREVIEW_PATH ) ).toBe( 'design' );
		expect( getPreviewRealm( '/wp-admin-guide/' ) ).toBe( 'frontend' );
		expect( getPreviewRealm( '/phpmyadmin-notes/' ) ).toBe( 'frontend' );
	} );

	it( 'maps realms to open events', () => {
		expect( getRealmOpenEvent( 'frontend' ) ).toBe( 'studio_site_open_in_browser' );
		expect( getRealmOpenEvent( 'admin' ) ).toBe( 'studio_site_open_wp_admin' );
		expect( getRealmOpenEvent( 'database' ) ).toBe( 'studio_site_open_phpmyadmin' );
		expect( getRealmOpenEvent( 'design' ) ).toBe( 'studio_site_open_design_system' );
	} );

	it( 'classifies addresses on a headless site’s frontend origin as the frontend app', () => {
		const frontendUrl = 'http://localhost:3000';
		expect( getPreviewRealm( 'http://localhost:3000/', frontendUrl ) ).toBe( 'frontend-app' );
		expect( getPreviewRealm( 'http://localhost:3000/wp-admin/', frontendUrl ) ).toBe(
			'frontend-app'
		);
		expect( getPreviewRealm( '/', frontendUrl ) ).toBe( 'frontend' );
		expect( getPreviewRealm( '/wp-admin/', frontendUrl ) ).toBe( 'admin' );
		expect( getPreviewRealm( 'http://localhost:3001/', frontendUrl ) ).toBe( 'frontend' );
		expect( getPreviewRealm( 'http://localhost:3000/' ) ).toBe( 'frontend' );
		expect( getRealmOpenEvent( 'frontend-app' ) ).toBe( 'studio_site_open_in_browser' );
	} );

	it( 'reads reported urls as frontend app addresses or site paths, by origin', () => {
		const frontendUrl = 'http://localhost:3000';
		expect(
			getPreviewLocationFromUrl( 'http://localhost:3000/blog?p=2', SITE_URL, frontendUrl )
		).toBe( 'http://localhost:3000/blog?p=2' );
		expect( getPreviewLocationFromUrl( `${ SITE_URL }/wp-admin/`, SITE_URL, frontendUrl ) ).toBe(
			'/wp-admin/'
		);
		expect( getPreviewLocationFromUrl( 'https://example.com/', SITE_URL, frontendUrl ) ).toBe(
			null
		);
		expect( getPreviewLocationFromUrl( 'http://localhost:3000/', SITE_URL, undefined ) ).toBe(
			null
		);
		expect( toFrontendAppPath( '/about/', frontendUrl ) ).toBe( 'http://localhost:3000/about/' );
		expect( getFrontendAppRelativePath( 'http://localhost:3000/about/?a=1#b' ) ).toBe(
			'/about/?a=1#b'
		);
	} );

	it( 'routes admin paths through auto-login', () => {
		expect( getRealmNavigationPath( '/wp-admin/plugins.php', SITE_URL ) ).toBe(
			autoLoginPath( '/wp-admin/plugins.php' )
		);
		expect( getRealmNavigationPath( '/about/', SITE_URL ) ).toBe( '/about/' );
		expect( getRealmNavigationPath( '/wp-admin-guide/', SITE_URL ) ).toBe( '/wp-admin-guide/' );
	} );
} );

describe( 'PreviewAddressBar', () => {
	beforeEach( () => window.localStorage.clear() );

	it( 'opens shortcuts on mouse-down before the click finishes', async () => {
		const user = userEvent.setup();
		renderAddressBar();
		const input = screen.getByRole( 'textbox', { name: 'Address' } );
		await user.pointer( { keys: '[MouseLeft>]', target: input } );
		expect( screen.getByRole( 'option', { name: 'WordPress Admin' } ) ).toBeVisible();
		expect( input ).toHaveFocus();
		await user.pointer( { keys: '[/MouseLeft]', target: input } );
		expect( screen.getByRole( 'option', { name: 'WordPress Admin' } ) ).toBeVisible();
		await user.click( screen.getByRole( 'option', { name: 'WordPress Admin' } ) );
	} );

	it( 'opens shortcuts on keyboard focus', async () => {
		const user = userEvent.setup();
		renderAddressBar();
		await user.tab();
		expect( screen.getByRole( 'textbox', { name: 'Address' } ) ).toHaveFocus();
		expect( await screen.findByRole( 'option', { name: 'WordPress Admin' } ) ).toBeVisible();
		await user.click( screen.getByRole( 'option', { name: 'WordPress Admin' } ) );
	} );

	it( 'keeps remote addresses editable without local shortcuts', async () => {
		const user = userEvent.setup();
		const { onNavigate } = renderAddressBar( { remote: true } );
		const input = screen.getByRole( 'textbox', { name: 'Address' } );
		await user.click( input );
		expect( screen.queryByRole( 'dialog', { name: 'Preview shortcuts' } ) ).not.toBeInTheDocument();
		await user.keyboard( '/about{Enter}' );
		expect( onNavigate ).toHaveBeenCalledWith( '/about' );
	} );

	it( 'keeps the address editable while shortcuts are open', async () => {
		const user = userEvent.setup();
		const { onNavigate } = renderAddressBar();
		const input = screen.getByRole( 'textbox', { name: 'Address' } ) as HTMLInputElement;
		await user.click( input );
		expect( await screen.findByRole( 'option', { name: 'WordPress Admin' } ) ).toBeVisible();
		expect( input ).toHaveFocus();
		expect( input.selectionStart ).toBe( 0 );
		expect( input.selectionEnd ).toBe( SITE_URL.length );
		await user.keyboard( '/about' );
		expect( input ).toHaveValue( '/about' );
		await user.clear( input );
		await user.keyboard( `${ SITE_URL }/about` );
		expect( input ).toHaveValue( `${ SITE_URL }/about` );
		await user.click( input );
		expect( input.selectionStart ).toBe( input.selectionEnd );
		expect( screen.getByRole( 'option', { name: 'WordPress Admin' } ) ).toBeVisible();
		await user.keyboard( '{Enter}' );
		expect( onNavigate ).toHaveBeenLastCalledWith( '/about' );
		await user.click( input );
		await user.clear( input );
		await user.keyboard( 'hello world{Enter}' );
		expect( onNavigate ).toHaveBeenLastCalledWith( '/?s=hello%20world' );
	} );

	it( 'flags an address off the site, and Escape restores the URL', async () => {
		const user = userEvent.setup();
		const { onNavigate } = renderAddressBar( { path: '/about/', remote: true } );
		const input = screen.getByRole( 'textbox', { name: 'Address' } );
		await user.click( input );

		fireEvent.change( input, { target: { value: 'https://example.com/' } } );
		fireEvent.submit( input.closest( 'form' )! );

		expect( onNavigate ).not.toHaveBeenCalled();
		expect( input ).toHaveAttribute( 'aria-invalid', 'true' );
		expect( input ).toHaveAttribute( 'title', 'Enter a path or an address on this site.' );

		await user.keyboard( '{Escape}' );

		expect( input ).toHaveValue( `${ SITE_URL }/about/` );
		expect( input ).not.toHaveAttribute( 'aria-invalid' );
		expect( input ).not.toHaveFocus();
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

	it( 'offers to open the current page in the OS browser when the host allows', () => {
		const onOpenExternal = vi.fn();
		render(
			<PreviewAddressBar
				site={ SITE }
				siteUrl={ SITE_URL }
				path="/wp-admin/plugins.php"
				onNavigate={ vi.fn() }
				onSwitchRealm={ vi.fn() }
				onOpenExternal={ onOpenExternal }
			/>
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Open this page in your browser' } ) );

		expect( onOpenExternal ).toHaveBeenCalledTimes( 1 );
		expect( screen.queryByRole( 'dialog', { name: 'Preview shortcuts' } ) ).not.toBeInTheDocument();
	} );

	it( 'shows preview shortcuts from the address field', async () => {
		const { onSwitchRealm } = renderAddressBar();
		const input = screen.getByRole( 'textbox', { name: 'Address' } );
		fireEvent.click( input );

		expect( await screen.findByRole( 'option', { name: /Front end/ } ) ).toBeVisible();
		expect( screen.getByRole( 'option', { name: /WordPress Admin/ } ) ).toBeVisible();
		fireEvent.click( screen.getByRole( 'option', { name: /Database/ } ) );

		expect( onSwitchRealm ).toHaveBeenCalledWith( 'database' );
		await waitFor( () =>
			expect( screen.queryByRole( 'option', { name: /Database/ } ) ).not.toBeInTheDocument()
		);
		fireEvent.focus( input );
		expect( await screen.findByRole( 'option', { name: /Database/ } ) ).toBeVisible();
	} );

	it( 'picks a shortcut with the arrow keys, and Enter otherwise goes to the address', async () => {
		const { onSwitchRealm, onNavigate } = renderAddressBar();
		const input = screen.getByRole( 'textbox', { name: 'Address' } );
		fireEvent.click( input );
		await screen.findByRole( 'option', { name: 'WordPress Admin' } );

		fireEvent.change( input, { target: { value: '/about/' } } );
		fireEvent.submit( input.closest( 'form' )! );
		expect( onNavigate ).toHaveBeenCalledWith( '/about/' );

		fireEvent.click( input );
		fireEvent.keyDown( input, { key: 'ArrowDown' } );
		expect( await screen.findByRole( 'option', { name: 'WordPress Admin' } ) ).toHaveAttribute(
			'aria-selected',
			'true'
		);
		fireEvent.keyDown( input, { key: 'Enter' } );
		expect( onSwitchRealm ).toHaveBeenCalledWith( 'admin' );
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
		expect( within( popup ).getByRole( 'option', { name: `${ SITE_URL }/about/` } ) ).toBeVisible();
	} );
} );
