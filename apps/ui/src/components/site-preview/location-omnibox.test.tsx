import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { Tooltip } from '@wordpress/ui';
import { describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { LocationOmnibox, parseOmniboxInput } from './location-omnibox';
import type { Mock } from 'vitest';

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

const useConnectorMock = vi.mocked( useConnector );

const SITE_URL = 'http://localhost:8881';

function createSearchResponse( results: unknown[] ) {
	return {
		status: 200,
		statusText: 'OK',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify( results ),
		url: '',
	};
}

function renderOmnibox( {
	fetchSiteRest = vi.fn().mockResolvedValue( createSearchResponse( [] ) ),
	onNavigate = vi.fn(),
	path = '/',
	searchEnabled = true,
}: {
	fetchSiteRest?: Mock;
	onNavigate?: Mock;
	path?: string;
	searchEnabled?: boolean;
} = {} ) {
	useConnectorMock.mockReturnValue( { fetchSiteRest } as never );
	const queryClient = new QueryClient( {
		defaultOptions: { queries: { retry: false } },
	} );
	render(
		<QueryClientProvider client={ queryClient }>
			<Tooltip.Provider>
				<LocationOmnibox
					siteId="site-1"
					siteUrl={ SITE_URL }
					path={ path }
					previewUrl={ `${ SITE_URL }${ path }` }
					pageTitle="Example Site"
					searchEnabled={ searchEnabled }
					anchorRef={ { current: document.body } }
					onNavigate={ onNavigate }
				/>
			</Tooltip.Provider>
		</QueryClientProvider>
	);
	return { fetchSiteRest, onNavigate };
}

async function openOmnibox() {
	// Base UI gives the trigger button `role="combobox"`, whose accessible
	// name ignores its contents — locate it by its visible text instead.
	fireEvent.click( screen.getByText( 'Example Site' ) );
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

describe( 'LocationOmnibox', () => {
	it( 'opens with the current path prefilled and selected', async () => {
		renderOmnibox( { path: '/wp-admin/' } );

		const input = ( await openOmnibox() ) as HTMLInputElement;

		expect( input.value ).toBe( '/wp-admin/' );
		expect( input.selectionStart ).toBe( 0 );
		expect( input.selectionEnd ).toBe( '/wp-admin/'.length );
	} );

	it( 'navigates to a typed path on Enter without querying search', async () => {
		const { fetchSiteRest, onNavigate } = renderOmnibox();

		const input = await openOmnibox();
		fireEvent.change( input, { target: { value: '/sample-page' } } );
		fireEvent.keyDown( input, { key: 'Enter' } );

		expect( onNavigate ).toHaveBeenCalledWith( '/sample-page' );
		expect( fetchSiteRest ).not.toHaveBeenCalled();
	} );

	it( 'searches the site for typed terms and navigates to a clicked result', async () => {
		const fetchSiteRest = vi.fn().mockResolvedValue(
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
		const { onNavigate } = renderOmnibox( { fetchSiteRest } );

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
		const { onNavigate } = renderOmnibox();

		const input = await openOmnibox();
		fireEvent.change( input, { target: { value: 'nothing' } } );

		await screen.findByText( 'No matches', {}, { timeout: 2000 } );
		fireEvent.keyDown( input, { key: 'Enter' } );

		expect( onNavigate ).toHaveBeenCalledWith( '/?s=nothing' );
	} );

	it( 'hides search entirely when disabled but still navigates typed paths', async () => {
		const { fetchSiteRest, onNavigate } = renderOmnibox( { searchEnabled: false } );

		const input = await openOmnibox();
		fireEvent.change( input, { target: { value: 'pricing' } } );

		fireEvent.keyDown( input, { key: 'Enter' } );
		expect( onNavigate ).toHaveBeenCalledWith( '/?s=pricing' );
		expect( fetchSiteRest ).not.toHaveBeenCalled();
		expect( screen.queryByText( 'No matches' ) ).not.toBeInTheDocument();
	} );
} );
