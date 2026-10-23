import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ConnectorProvider } from '@/data/core';
import { requestHeaderPanel } from '@/hooks/use-open-header-panel';
import { SiteHeaderActions } from './index';
import type { Connector, SiteDetails } from '@/data/core';

const site: SiteDetails = {
	id: 'header-site',
	name: 'Ada Portfolio',
	path: '/tmp/ada',
	port: 8881,
	running: false,
	phpVersion: '8.3',
};

function renderActions( overrides: Partial< SiteDetails > = {} ) {
	const connector = {
		capabilities: {},
		getAuthUser: vi
			.fn()
			.mockResolvedValue( { id: 1, email: 'ada@example.com', displayName: 'Ada' } ),
		getConnectedWpcomSites: vi.fn().mockResolvedValue( [] ),
		getUserPreferences: vi.fn().mockResolvedValue( {} ),
		getPublishCheckoutUrl: vi.fn( () => 'https://wordpress.com/checkout' ),
		trackEvent: vi.fn(),
	} as unknown as Connector;
	render(
		<QueryClientProvider
			client={ new QueryClient( { defaultOptions: { queries: { retry: false } } } ) }
		>
			<ConnectorProvider connector={ connector }>
				<TooltipProvider>
					<SiteHeaderActions site={ { ...site, ...overrides } } anchor={ createRef() } />
				</TooltipProvider>
			</ConnectorProvider>
		</QueryClientProvider>
	);
}

describe( 'SiteHeaderActions', () => {
	it( 'keeps Publish out of a stopped site’s header but still opens it from the site menu', async () => {
		renderActions();

		expect( screen.getByRole( 'button', { name: 'Start' } ) ).toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Publish…' } ) ).not.toBeInTheDocument();

		act( () => requestHeaderPanel( { panel: 'publish', siteId: site.id, view: 'publish' } ) );

		expect( await screen.findByText( 'Publish your WordPress' ) ).toBeInTheDocument();
	} );

	it( 'shows Publish for a running site', () => {
		renderActions( { running: true } );

		expect( screen.getByRole( 'button', { name: 'Publish…' } ) ).toBeInTheDocument();
	} );
} );
