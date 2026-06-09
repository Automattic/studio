import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useConnector } from '@/data/core';
import { SitePreview } from './index';
import type { SiteDetails } from '@/data/core';
import type { ReactNode } from 'react';

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

const useConnectorMock = vi.mocked( useConnector );

function renderPreview( children: ReactNode ) {
	const queryClient = new QueryClient( {
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	} );
	return render( <QueryClientProvider client={ queryClient }>{ children }</QueryClientProvider> );
}

function createSite( overrides: Partial< SiteDetails > = {} ): SiteDetails {
	return {
		id: 'site-1',
		name: 'Example Site',
		path: '/Users/example/Studio/example-site',
		port: 8881,
		running: false,
		phpVersion: '8.3',
		...overrides,
	};
}

describe( 'SitePreview', () => {
	it( 'does not render browser tab controls', () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
		} as never );

		renderPreview(
			<SitePreview site={ createSite( { running: true } ) } path="/wp-admin/" reloadNonce={ 0 } />
		);

		expect( screen.queryByRole( 'tablist', { name: 'Browser tabs' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'tab' ) ).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Open new browser tab' } )
		).not.toBeInTheDocument();
	} );

	it( 'shows the current page title and exposes the URL in a tooltip', async () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
		} as never );

		renderPreview(
			<SitePreview site={ createSite( { running: true } ) } path="/wp-admin/" reloadNonce={ 0 } />
		);

		const pageTitle = screen.getByText( 'Example Site' );
		expect( pageTitle ).toBeVisible();

		fireEvent.mouseEnter( pageTitle );

		expect( await screen.findByText( 'http://localhost:8881/wp-admin/' ) ).toBeVisible();
	} );

	it( 'hides the browser toolbar when the site is not running', () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
		} as never );

		renderPreview( <SitePreview site={ createSite() } path="/wp-admin/" reloadNonce={ 0 } /> );

		expect( screen.queryByRole( 'button', { name: 'Refresh' } ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'http://localhost:8881/wp-admin/' ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Start site' } ) ).toBeVisible();
	} );

	it( 'shows a refresh button that reloads the active preview surface', () => {
		useConnectorMock.mockReturnValue( {
			fetchSiteRest: vi.fn().mockResolvedValue( { status: 200, body: '[]' } ),
			startSite: vi.fn().mockResolvedValue( undefined ),
		} as never );

		const { container } = renderPreview(
			<SitePreview site={ createSite( { running: true } ) } path="/" reloadNonce={ 0 } />
		);

		const refreshButton = screen.getByRole( 'button', { name: 'Refresh' } );
		expect( refreshButton ).toBeEnabled();
		expect( refreshButton ).toHaveAttribute( 'aria-keyshortcuts', expect.stringMatching( /\+R$/ ) );

		const initialIframe = container.querySelector( 'iframe' );
		expect( initialIframe ).toBeInTheDocument();

		fireEvent.click( refreshButton );

		expect( container.querySelector( 'iframe' ) ).not.toBe( initialIframe );
	} );
} );
