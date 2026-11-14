import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { requestHeaderPanel } from '@/data/use-open-header-panel';
import { SessionUIProvider } from '@/data/use-session-ui';
import { createFakeConnector, TEST_USER } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { SiteHeaderActions, SiteHeaderActionsProvider, SiteHeaderSpace } from './index';
import type { SiteDetails } from '@/data/core';

let siteCount = 0;

async function renderActions( multipleTargets = false ) {
	const site: SiteDetails = {
		id: `header-site-${ ++siteCount }`,
		name: 'Ada Portfolio',
		path: '/tmp/ada',
		port: 8881,
		running: false,
		phpVersion: '8.3',
	};
	const connector = createFakeConnector(
		{ sites: [ site ] },
		multipleTargets
			? {
					getRemoteSites: async ( provider ) =>
						provider === 'wpcom'
							? [
									{
										id: 42,
										name: 'Published site',
										url: 'https://published.example.com',
										localSiteId: site.id,
										isStaging: false,
										isPressable: false,
										syncSupport: 'syncable',
										lastPushTimestamp: new Date().toISOString(),
										lastPullTimestamp: null,
									},
							  ]
							: [],
					getSnapshots: async () => [
						{
							atomicSiteId: 123,
							localSiteId: site.id,
							userId: TEST_USER.id,
							url: 'preview.example.com',
							date: Date.now(),
						},
					],
			  }
			: {}
	);
	renderWithProviders(
		<SessionUIProvider>
			<SiteHeaderActionsProvider host="chat">
				<div data-site-header>
					<SiteHeaderSpace />
				</div>
				<SiteHeaderActions site={ site } />
			</SiteHeaderActionsProvider>
		</SessionUIProvider>,
		{ connector }
	);
	await screen.findByRole( 'button', { name: multipleTargets ? 'Publish…' : 'Share…' } );
	return { site };
}

describe( 'SiteHeaderActions', () => {
	it( 'keeps Share visible for a stopped site and opens it from the site menu', async () => {
		const { site } = await renderActions();

		expect( screen.queryByRole( 'button', { name: 'Start' } ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Share…' } ) ).toHaveAttribute(
			'data-variant',
			'accent'
		);
		expect(
			screen.queryByRole( 'button', { name: 'Choose destination' } )
		).not.toBeInTheDocument();

		act( () => requestHeaderPanel( { panel: 'publish', siteId: site.id, view: 'publish' } ) );

		expect( await screen.findByRole( 'dialog', { name: 'Share' } ) ).toBeVisible();
	} );

	it( 'opens Share and returns focus to its fixed header button', async () => {
		await renderActions();
		const actions = userEvent.setup();
		const share = screen.getByRole( 'button', { name: 'Share…' } );
		await actions.click( share );
		await screen.findByRole( 'dialog' );
		await actions.keyboard( '{Escape}' );
		await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
		await waitFor( () => expect( share ).toHaveFocus() );
	} );

	it( 'keeps the header to one Publish button when the site has multiple targets', async () => {
		await renderActions( true );
		const actions = userEvent.setup();
		expect(
			screen.queryByRole( 'button', { name: 'Choose destination' } )
		).not.toBeInTheDocument();
		await actions.click( screen.getByRole( 'button', { name: 'Publish…' } ) );
		const panel = await screen.findByRole( 'dialog', { name: 'Publish' } );
		expect(
			within( panel ).getByRole( 'button', { name: 'published.example.com' } )
		).toBeVisible();
		expect(
			within( panel ).queryByRole( 'button', { name: 'Choose destination' } )
		).not.toBeInTheDocument();
		expect( within( panel ).getByRole( 'heading', { name: 'Publish' } ) ).toBeVisible();
		expect(
			within( panel ).queryByRole( 'button', { name: 'Open preview: Preview 1' } )
		).not.toBeInTheDocument();
		await actions.click( within( panel ).getByRole( 'button', { name: 'Previews' } ) );
		const menu = await screen.findByRole( 'menu', { name: 'Previews' } );
		expect( within( menu ).getByRole( 'menuitem', { name: 'Preview 1' } ) ).toBeVisible();
		expect(
			within( panel ).getByRole( 'button', { name: 'published.example.com' } )
		).toBeVisible();
	} );
} );
