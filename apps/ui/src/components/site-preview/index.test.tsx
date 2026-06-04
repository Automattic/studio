import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
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
	it( 'shows the selected tab path only while editing the tab', () => {
		useConnectorMock.mockReturnValue( {
			startSite: vi.fn().mockResolvedValue( undefined ),
		} as never );

		renderPreview(
			<SitePreview
				site={ createSite() }
				path="/wp-admin/"
				reloadNonce={ 0 }
				tabs={ [ { id: 'tab-1', path: '/wp-admin/', reloadNonce: 0 } ] }
				activeTabId="tab-1"
			/>
		);

		const tab = screen.getByRole( 'tab', { selected: true } );
		expect( within( tab ).getByText( 'Dashboard' ) ).toBeVisible();
		expect( within( tab ).queryByText( '/wp-admin/' ) ).not.toBeInTheDocument();

		fireEvent.doubleClick( within( tab ).getByRole( 'button', { name: 'Dashboard' } ) );

		expect( screen.getByRole( 'textbox', { name: 'Browser path' } ) ).toHaveValue( '/wp-admin/' );
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
