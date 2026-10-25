import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectorProvider } from '@/data/core';
import { requestHeaderPanel } from '@/data/use-open-header-panel';
import { TooltipProvider } from '@/lib/ui';
import { SiteHeaderActions, SiteHeaderActionsProvider, SiteHeaderSpace } from './index';
import type { Connector, SiteDetails } from '@/data/core';

let siteCount = 0;

function renderActions( {
	running = false,
	host = 'chat',
	headerWidth = 1000,
	live = false,
}: {
	running?: boolean;
	host?: 'chat' | 'preview';
	headerWidth?: number;
	live?: boolean;
} = {} ) {
	// jsdom lays nothing out: every element measures 40px, the header as asked.
	vi.spyOn( HTMLElement.prototype, 'getBoundingClientRect' ).mockReturnValue( {
		width: 40,
	} as DOMRect );
	vi.spyOn( HTMLElement.prototype, 'clientWidth', 'get' ).mockImplementation( function (
		this: HTMLElement
	) {
		return this.hasAttribute( 'data-site-header' ) ? headerWidth : 0;
	} );
	const site: SiteDetails = {
		id: `header-site-${ ++siteCount }`,
		name: 'Ada Portfolio',
		path: '/tmp/ada',
		port: 8881,
		running,
		phpVersion: '8.3',
	};
	const connector = {
		capabilities: {},
		getAuthUser: vi
			.fn()
			.mockResolvedValue( { id: 1, email: 'ada@example.com', displayName: 'Ada' } ),
		getConnectedWpcomSites: vi.fn().mockResolvedValue( [] ),
		getUserPreferences: vi.fn().mockResolvedValue( {} ),
		getPublishCheckoutUrl: vi.fn( () => 'https://wordpress.com/checkout' ),
		startSite: vi.fn().mockResolvedValue( undefined ),
		getSites: vi.fn().mockResolvedValue( [] ),
		isFullscreen: vi.fn().mockResolvedValue( false ),
		onFullscreenChange: vi.fn( () => () => {} ),
		trackEvent: vi.fn(),
	} as unknown as Connector;
	render(
		<QueryClientProvider
			client={ new QueryClient( { defaultOptions: { queries: { retry: false } } } ) }
		>
			<ConnectorProvider connector={ connector }>
				<TooltipProvider>
					<SiteHeaderActionsProvider host={ host }>
						<div data-site-header>
							<SiteHeaderSpace />
						</div>
						<SiteHeaderActions site={ site } live={ live } />
					</SiteHeaderActionsProvider>
				</TooltipProvider>
			</ConnectorProvider>
		</QueryClientProvider>
	);
	return { site, connector };
}

describe( 'SiteHeaderActions', () => {
	afterEach( () => vi.restoreAllMocks() );

	it( 'keeps Publish out of a stopped site’s header but still opens it from the site menu', async () => {
		const { site } = renderActions();

		expect( screen.getByRole( 'button', { name: 'Start' } ) ).toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Publish…' } ) ).not.toBeInTheDocument();

		act( () => requestHeaderPanel( { panel: 'publish', siteId: site.id, view: 'publish' } ) );

		expect( await screen.findByText( 'Publish your WordPress' ) ).toBeInTheDocument();
	} );

	it( 'shows Publish only over a running site’s preview', () => {
		renderActions( { running: true, host: 'preview' } );

		expect( screen.getByRole( 'button', { name: 'Publish…' } ) ).toBeInTheDocument();
	} );

	it( 'keeps Publish hidden while the chat fills the workspace', () => {
		renderActions( { running: true, host: 'chat' } );

		expect( screen.queryByRole( 'button', { name: 'Publish…' } ) ).not.toBeInTheDocument();
	} );

	it( 'folds Share into a More menu and drops the Start label when the header runs out of room', async () => {
		renderActions( { headerWidth: 60 } );

		expect( screen.queryByRole( 'button', { name: 'Share' } ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Start' } ) ).toHaveAttribute(
			'data-size',
			'icon'
		);
		await userEvent.click( screen.getByRole( 'button', { name: 'More preview actions' } ) );
		expect( await screen.findByRole( 'menuitem', { name: 'Share' } ) ).toBeInTheDocument();
	} );

	it( 'keeps Share and the Start label inline when they fit', () => {
		renderActions( { headerWidth: 1000 } );

		expect( screen.getByRole( 'button', { name: 'Share' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Start' } ) ).toHaveAttribute(
			'data-size',
			'default'
		);
		expect(
			screen.queryByRole( 'button', { name: 'More preview actions' } )
		).not.toBeInTheDocument();
	} );

	it( 'keeps only Publish over a Live chat’s preview, even with the local site stopped', async () => {
		renderActions( { host: 'preview', live: true, headerWidth: 60 } );

		expect( screen.getByRole( 'button', { name: 'Publish…' } ) ).toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Start' } ) ).not.toBeInTheDocument();
		await userEvent.click( screen.getByRole( 'button', { name: 'More preview actions' } ) );
		expect( screen.queryByRole( 'menuitem', { name: 'Share' } ) ).not.toBeInTheDocument();
	} );

	it( 'starts the site', async () => {
		const { site, connector } = renderActions();

		await userEvent.click( screen.getByRole( 'button', { name: 'Start' } ) );

		await waitFor( () => expect( connector.startSite ).toHaveBeenCalledWith( site.id ) );
	} );
} );
