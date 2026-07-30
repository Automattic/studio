import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Tooltip } from '@wordpress/ui';
import { describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import {
	getPreviewRealm,
	getRealmNavigationPath,
	parseOmniboxInput,
	PreviewAddressBar,
} from './address-bar';
import type { SiteDetails } from '@/data/core';
import type { Mock } from 'vitest';

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

const useConnectorMock = vi.mocked( useConnector );

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

function createSearchResponse( results: unknown[] ) {
	return {
		status: 200,
		statusText: 'OK',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify( results ),
		url: '',
	};
}

function renderAddressBar( {
	fetchSiteRest = vi.fn().mockResolvedValue( createSearchResponse( [] ) ),
	onNavigate = vi.fn(),
	onSwitchRealm = vi.fn(),
	path = '/',
	searchEnabled = true,
	showDatabaseTab = true,
	site = SITE,
}: {
	fetchSiteRest?: Mock;
	onNavigate?: Mock;
	onSwitchRealm?: Mock;
	path?: string;
	searchEnabled?: boolean;
	showDatabaseTab?: boolean;
	site?: SiteDetails;
} = {} ) {
	useConnectorMock.mockReturnValue( { fetchSiteRest } as never );
	const queryClient = new QueryClient( {
		defaultOptions: { queries: { retry: false } },
	} );
	render(
		<QueryClientProvider client={ queryClient }>
			<Tooltip.Provider>
				<PreviewAddressBar
					site={ site }
					siteUrl={ SITE_URL }
					path={ path }
					searchEnabled={ searchEnabled }
					anchorRef={ { current: document.body } }
					showDatabaseTab={ showDatabaseTab }
					onNavigate={ onNavigate }
					onSwitchRealm={ onSwitchRealm }
				/>
			</Tooltip.Provider>
		</QueryClientProvider>
	);
	return { fetchSiteRest, onNavigate, onSwitchRealm };
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

		// The front end is active (it carries the page title); the other two
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

		// Non-block-theme destinations: the Customizer group and the content
		// group (WP Admin and the database live in the segments, not the list).
		fireEvent.click( await screen.findByText( 'Customizer' ) );

		expect( onNavigate ).toHaveBeenCalledWith( autoLoginPath( '/wp-admin/customize.php' ) );
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

	it( 'offers the latest post and a page as real front-end permalinks', async () => {
		const fetchSiteRest = vi
			.fn()
			.mockImplementation( ( _siteId: string, request: { path: string } ) => {
				if ( request.path.includes( '/wp/v2/posts' ) ) {
					return Promise.resolve(
						createSearchResponse( [
							{
								id: 5,
								link: 'http://127.0.0.1:8881/hello-world/',
								title: { rendered: 'Hello World' },
							},
						] )
					);
				}
				if ( request.path.includes( '/wp/v2/pages' ) ) {
					return Promise.resolve(
						createSearchResponse( [
							{ id: 2, link: 'http://127.0.0.1:8881/about/', title: { rendered: 'About' } },
						] )
					);
				}
				return Promise.resolve( createSearchResponse( [] ) );
			} );
		const { onNavigate } = renderAddressBar( { fetchSiteRest, path: '/' } );

		await openOmnibox();
		fireEvent.click( await screen.findByText( 'Hello World' ) );

		expect( onNavigate ).toHaveBeenCalledWith( '/hello-world/' );
	} );

	it( 'marks the destination matching the current path as current', async () => {
		renderAddressBar( { path: '/wp-admin/upload.php' } );

		await openOmnibox( 'WordPress' );

		const list = await screen.findByRole( 'listbox' );
		expect( within( list ).getByRole( 'option', { name: /Media Library/ } ) ).toHaveAttribute(
			'aria-current',
			'page'
		);
		expect( within( list ).getByRole( 'option', { name: /Home/ } ) ).not.toHaveAttribute(
			'aria-current'
		);
	} );

	it( 'marks only the most specific destination when pathnames collide', async () => {
		// Posts and Pages both live on edit.php; only Pages pins post_type.
		renderAddressBar( { path: '/wp-admin/edit.php?post_type=page' } );

		await openOmnibox( 'WordPress' );

		const list = await screen.findByRole( 'listbox' );
		expect( within( list ).getByRole( 'option', { name: /Pages/ } ) ).toHaveAttribute(
			'aria-current',
			'page'
		);
		expect( within( list ).getByRole( 'option', { name: /Posts/ } ) ).not.toHaveAttribute(
			'aria-current'
		);
	} );

	it( 'matches site-editor destinations after WP Admin rewrites their URLs', async () => {
		// The site editor renames its `path` param to `p` and appends extras.
		renderAddressBar( {
			path: '/wp-admin/site-editor.php?p=%2Fnavigation&canvas=edit',
			site: { ...SITE, themeDetails: { isBlockTheme: true } } as SiteDetails,
		} );

		await openOmnibox( 'WordPress' );

		const list = await screen.findByRole( 'listbox' );
		expect( within( list ).getByRole( 'option', { name: /Navigation/ } ) ).toHaveAttribute(
			'aria-current',
			'page'
		);
		expect( within( list ).getByRole( 'option', { name: /Site Editor/ } ) ).not.toHaveAttribute(
			'aria-current'
		);
	} );

	it.each( [
		[ '/wp-admin/site-editor.php?p=%2Ftemplate', /Templates/ ],
		[ '/wp-admin/site-editor.php?p=%2Fpattern', /Patterns/ ],
		[ '/wp-admin/site-editor.php?p=%2Fstyles&canvas=edit', /Styles/ ],
	] )(
		'matches renamed site-editor route slugs (%s)',
		async ( currentPath: string, rowName: RegExp ) => {
			renderAddressBar( {
				path: currentPath,
				site: { ...SITE, themeDetails: { isBlockTheme: true } } as SiteDetails,
			} );

			await openOmnibox( 'WordPress' );

			const list = await screen.findByRole( 'listbox' );
			expect( within( list ).getByRole( 'option', { name: rowName } ) ).toHaveAttribute(
				'aria-current',
				'page'
			);
			expect( within( list ).getByRole( 'option', { name: /Site Editor/ } ) ).not.toHaveAttribute(
				'aria-current'
			);
		}
	);

	it( 'offers no WP Admin or Database rows — their segments cover those realms', async () => {
		renderAddressBar( { path: '/' } );

		await openOmnibox();

		const list = await screen.findByRole( 'listbox' );
		expect( within( list ).queryByRole( 'option', { name: /WP Admin/ } ) ).not.toBeInTheDocument();
		expect( within( list ).queryByRole( 'option', { name: /Database/ } ) ).not.toBeInTheDocument();
	} );

	it( 'keeps typing focus in the input through the empty-results window', async () => {
		renderAddressBar();

		const input = await openOmnibox();
		// jsdom doesn't move focus on click-open the way the browser does.
		input.focus();
		expect( document.activeElement ).toBe( input );
		fireEvent.change( input, { target: { value: 'a' } } );
		expect( document.activeElement ).toBe( input );
		fireEvent.change( input, { target: { value: 'as' } } );
		expect( document.activeElement ).toBe( input );
		// Let the debounced search fire and settle with zero results.
		await screen.findByText( 'No matches' );
		expect( document.activeElement ).toBe( input );
	} );

	it( 'navigates to a typed path on Enter without querying search', async () => {
		const { fetchSiteRest, onNavigate } = renderAddressBar();

		const input = await openOmnibox();
		fireEvent.change( input, { target: { value: '/sample-page' } } );
		fireEvent.keyDown( input, { key: 'Enter' } );

		expect( onNavigate ).toHaveBeenCalledWith( '/sample-page' );
		// Opening the omnibox fetches front-end links, but typing a path must
		// not trigger the content search endpoint.
		expect( fetchSiteRest ).not.toHaveBeenCalledWith(
			'site-1',
			expect.objectContaining( { path: expect.stringContaining( '/wp/v2/search' ) } )
		);
	} );

	it( 'routes typed wp-admin paths through auto-login', async () => {
		const { onNavigate } = renderAddressBar();

		const input = await openOmnibox();
		fireEvent.change( input, { target: { value: '/wp-admin/plugins.php' } } );
		fireEvent.keyDown( input, { key: 'Enter' } );

		expect( onNavigate ).toHaveBeenCalledWith( autoLoginPath( '/wp-admin/plugins.php' ) );
	} );

	it( 'matches destinations while typing alongside content results', async () => {
		const { onNavigate } = renderAddressBar();

		const input = await openOmnibox();
		fireEvent.change( input, { target: { value: 'media' } } );

		fireEvent.click( await screen.findByText( 'Media Library' ) );

		expect( onNavigate ).toHaveBeenCalledWith( autoLoginPath( '/wp-admin/upload.php' ) );
	} );

	it( 'searches the site for typed terms and navigates to a clicked result', async () => {
		const fetchSiteRest = vi
			.fn()
			.mockImplementation( ( _siteId: string, request: { path: string } ) => {
				// Only the content-search endpoint returns a match; front-end link
				// lookups stay empty so they don't blend into the search results.
				if ( request.path.includes( '/wp/v2/search' ) ) {
					return Promise.resolve(
						createSearchResponse( [
							{
								id: 12,
								title: 'About &amp; Team',
								url: 'http://127.0.0.1:8881/about/',
								type: 'post',
								subtype: 'page',
							},
						] )
					);
				}
				return Promise.resolve( createSearchResponse( [] ) );
			} );
		const { onNavigate } = renderAddressBar( { fetchSiteRest } );

		const input = await openOmnibox();
		fireEvent.change( input, { target: { value: 'about' } } );

		const result = await screen.findByText( 'About & Team', {}, { timeout: 2000 } );
		expect( fetchSiteRest ).toHaveBeenCalledWith(
			'site-1',
			expect.objectContaining( {
				path: expect.stringContaining( '/wp/v2/search?search=about' ),
			} )
		);

		fireEvent.click( result );

		expect( onNavigate ).toHaveBeenCalledWith( '/about/' );
	} );

	it( 'falls back to the site search page on Enter when there are no results', async () => {
		const { onNavigate } = renderAddressBar();

		const input = await openOmnibox();
		fireEvent.change( input, { target: { value: 'nothing' } } );

		await screen.findByText( 'No matches', {}, { timeout: 2000 } );
		fireEvent.keyDown( input, { key: 'Enter' } );

		expect( onNavigate ).toHaveBeenCalledWith( '/?s=nothing' );
	} );

	it( 'hides search entirely when disabled but still navigates typed paths', async () => {
		const { fetchSiteRest, onNavigate } = renderAddressBar( { searchEnabled: false } );

		const input = await openOmnibox();
		fireEvent.change( input, { target: { value: 'pricing' } } );

		fireEvent.keyDown( input, { key: 'Enter' } );
		expect( onNavigate ).toHaveBeenCalledWith( '/?s=pricing' );
		expect( fetchSiteRest ).not.toHaveBeenCalled();
		expect( screen.queryByText( 'No matches' ) ).not.toBeInTheDocument();
	} );
} );
