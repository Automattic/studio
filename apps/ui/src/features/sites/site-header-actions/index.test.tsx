import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestHeaderPanel } from '@/data/use-open-header-panel';
import { SessionUIProvider } from '@/data/use-session-ui';
import { createFakeConnector } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { SiteHeaderActions, SiteHeaderActionsProvider, SiteHeaderSpace } from './index';
import type { SiteDetails } from '@/data/core';

let siteCount = 0;

async function renderActions( {
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
	const connector = createFakeConnector( { sites: [ site ] } );
	renderWithProviders(
		<SessionUIProvider>
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
		</SessionUIProvider>,
		{ connector }
	);
	await screen.findByRole( 'button', { name: 'Publish…' } );
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
		const { site } = await renderActions();

		expect( screen.queryByRole( 'button', { name: 'Start' } ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Publish…' } ) ).toBeVisible();

		act( () => requestHeaderPanel( { panel: 'publish', siteId: site.id, view: 'publish' } ) );

		expect( await screen.findByText( 'Publish your WordPress' ) ).toBeInTheDocument();
	} );

	it( 'shows Publish over a running site’s preview', async () => {
		await renderActions( { running: true, host: 'preview' } );

		expect( screen.getByRole( 'button', { name: 'Publish…' } ) ).toBeInTheDocument();
	} );

	it( 'keeps Publish visible while the chat fills the workspace', async () => {
		await renderActions( { running: true, host: 'chat' } );

		expect( screen.getByRole( 'button', { name: 'Publish…' } ) ).toBeVisible();
	} );

	it.each( [ 'start', 'stop' ] as const )( 'keeps Publish visible during %s', async ( kind ) => {
		await renderActions( { host: 'preview', operation: { kind, pid: 123 } } );
		expect( screen.getByRole( 'button', { name: 'Publish…' } ) ).toBeVisible();
	} );

	it( 'keeps Share beside Publish when the header runs out of room', async () => {
		await renderActions( { headerWidth: 60 } );
		expect( screen.getByRole( 'button', { name: 'Share' } ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Publish…' } ) ).toBeVisible();
		expect(
			screen.queryByRole( 'button', { name: 'More preview actions' } )
		).not.toBeInTheDocument();
	} );

	it( 'opens Share and returns focus to its fixed header button', async () => {
		await renderActions( { headerWidth: 60 } );
		const actions = userEvent.setup();
		const share = screen.getByRole( 'button', { name: 'Share' } );
		await actions.click( share );
		await screen.findByRole( 'dialog' );
		await actions.keyboard( '{Escape}' );
		await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
		await waitFor( () => expect( share ).toHaveFocus() );
	} );

	it( 'keeps Share inline when it fits', async () => {
		await renderActions( { headerWidth: 1000 } );

		expect( screen.getByRole( 'button', { name: 'Share' } ) ).toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Start' } ) ).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'More preview actions' } )
		).not.toBeInTheDocument();
	} );

	it( 'keeps Publish and Share inline over a Live preview, even with the local site stopped', async () => {
		await renderActions( { host: 'preview', live: true, headerWidth: 60 } );

		expect( screen.getByRole( 'button', { name: 'Publish…' } ) ).toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Start' } ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Share' } ) ).toBeVisible();
	} );

	it( 'keeps Share beside Publish over a Live chat’s preview when it fits', async () => {
		await renderActions( { host: 'preview', live: true, headerWidth: 1000 } );

		expect( screen.getByRole( 'button', { name: 'Publish…' } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Share' } ) ).toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'More preview actions' } )
		).not.toBeInTheDocument();
	} );
} );
