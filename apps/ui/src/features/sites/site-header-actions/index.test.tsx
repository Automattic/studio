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
	navigation = false,
	operation,
}: {
	running?: boolean;
	host?: 'chat' | 'preview';
	headerWidth?: number;
	live?: boolean;
	navigation?: boolean;
	operation?: SiteDetails[ 'operation' ];
} = {} ) {
	let width = headerWidth;
	// jsdom lays nothing out: every element measures 40px, the header as asked.
	vi.spyOn( HTMLElement.prototype, 'getBoundingClientRect' ).mockReturnValue( {
		width: 40,
	} as DOMRect );
	vi.spyOn( HTMLElement.prototype, 'clientWidth', 'get' ).mockImplementation( function (
		this: HTMLElement
	) {
		return this.hasAttribute( 'data-site-header' ) ? width : 0;
	} );
	const site: SiteDetails = {
		id: `header-site-${ ++siteCount }`,
		name: 'Ada Portfolio',
		path: '/tmp/ada',
		port: 8881,
		running,
		phpVersion: '8.3',
		operation,
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
							{ navigation ? (
								<div data-site-header-navigation>
									<button>Reload preview</button>
								</div>
							) : null }
							<SiteHeaderSpace />
						</div>
						<SiteHeaderActions site={ site } live={ live } />
					</SiteHeaderActionsProvider>
				</TooltipProvider>
			</ConnectorProvider>
		</QueryClientProvider>
	);
	// The header re-measures on any change inside it.
	const resize = ( next: number ) =>
		act( async () => {
			width = next;
			document.querySelector( '[data-site-header]' )!.setAttribute( 'data-width', String( next ) );
		} );
	return { site, connector, resize };
}

describe( 'SiteHeaderActions', () => {
	afterEach( () => vi.restoreAllMocks() );

	it( 'keeps Publish visible for a stopped site and opens it from the site menu', async () => {
		const { site } = renderActions();

		expect( screen.queryByRole( 'button', { name: 'Start' } ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Publish…' } ) ).toBeVisible();

		act( () => requestHeaderPanel( { panel: 'publish', siteId: site.id, view: 'publish' } ) );

		expect( await screen.findByText( 'Publish your WordPress' ) ).toBeInTheDocument();
	} );

	it( 'shows Publish over a running site’s preview', () => {
		renderActions( { running: true, host: 'preview' } );

		expect( screen.getByRole( 'button', { name: 'Publish…' } ) ).toBeInTheDocument();
	} );

	it( 'keeps Publish visible while the chat fills the workspace', () => {
		renderActions( { running: true, host: 'chat' } );

		expect( screen.getByRole( 'button', { name: 'Publish…' } ) ).toBeVisible();
	} );

	it.each( [ 'start', 'stop' ] as const )( 'keeps Publish visible during %s', ( kind ) => {
		renderActions( { host: 'preview', operation: { kind, pid: 123 } } );
		expect( screen.getByRole( 'button', { name: 'Publish…' } ) ).toBeVisible();
	} );

	it( 'folds Share into a More menu when the header runs out of room', async () => {
		renderActions( { headerWidth: 60 } );

		expect( screen.queryByRole( 'button', { name: 'Share' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Start' } ) ).not.toBeInTheDocument();
		await userEvent.click( screen.getByRole( 'button', { name: 'More preview actions' } ) );
		expect( await screen.findByRole( 'menuitem', { name: 'Share' } ) ).toBeInTheDocument();
	} );

	it( 'opens Share from More and returns focus to the visible overflow trigger', async () => {
		const { connector } = renderActions( { headerWidth: 60 } );
		connector.getSnapshots = vi.fn().mockResolvedValue( [] );
		connector.getSnapshotUsage = vi.fn().mockResolvedValue( null );
		const actions = userEvent.setup();
		const more = screen.getByRole( 'button', { name: 'More preview actions' } );
		await actions.click( more );
		await actions.click( await screen.findByRole( 'menuitem', { name: 'Share' } ) );
		await screen.findByRole( 'button', { name: 'Create preview' } );
		await actions.keyboard( '{Escape}' );
		await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
		await waitFor( () => expect( more ).toHaveFocus() );
	} );

	it( 'hands focus to More when the focused browser control folds into it', async () => {
		const { resize } = renderActions( { navigation: true } );
		screen.getByRole( 'button', { name: 'Reload preview' } ).focus();

		await resize( 60 );

		expect( screen.getByRole( 'button', { name: 'More preview actions' } ) ).toHaveFocus();
	} );

	it( 'keeps Share inline when it fits', () => {
		renderActions( { headerWidth: 1000 } );

		expect( screen.getByRole( 'button', { name: 'Share' } ) ).toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Start' } ) ).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'More preview actions' } )
		).not.toBeInTheDocument();
	} );

	it( 'keeps Publish and preview sharing over a Live chat’s preview, even with the local site stopped', async () => {
		renderActions( { host: 'preview', live: true, headerWidth: 60 } );

		expect( screen.getByRole( 'button', { name: 'Publish…' } ) ).toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Start' } ) ).not.toBeInTheDocument();
		await userEvent.click( screen.getByRole( 'button', { name: 'More preview actions' } ) );
		expect( await screen.findByRole( 'menuitem', { name: 'Share' } ) ).toBeInTheDocument();
	} );

	it( 'keeps Share beside Publish over a Live chat’s preview when it fits', () => {
		renderActions( { host: 'preview', live: true, headerWidth: 1000 } );

		expect( screen.getByRole( 'button', { name: 'Publish…' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Share' } ) ).toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'More preview actions' } )
		).not.toBeInTheDocument();
	} );
} );
