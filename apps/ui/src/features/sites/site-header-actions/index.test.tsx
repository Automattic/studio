import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { requestHeaderPanel } from '@/data/use-open-header-panel';
import { SessionUIProvider } from '@/data/use-session-ui';
import { createFakeConnector } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { SiteHeaderActions, SiteHeaderActionsProvider, SiteHeaderSpace } from './index';
import type { SiteDetails } from '@/data/core';

let siteCount = 0;

async function renderActions() {
	const site: SiteDetails = {
		id: `header-site-${ ++siteCount }`,
		name: 'Ada Portfolio',
		path: '/tmp/ada',
		port: 8881,
		running: false,
		phpVersion: '8.3',
	};
	const connector = createFakeConnector( { sites: [ site ] } );
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
	await screen.findByRole( 'button', { name: 'Publish…' } );
	return { site };
}

describe( 'SiteHeaderActions', () => {
	it( 'keeps Publish visible for a stopped site and opens it from the site menu', async () => {
		const { site } = await renderActions();

		expect( screen.queryByRole( 'button', { name: 'Start' } ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Share' } ) ).toHaveAttribute(
			'data-variant',
			'ghost'
		);
		expect( screen.getByRole( 'button', { name: 'Publish…' } ) ).toHaveAttribute(
			'data-variant',
			'accent'
		);

		act( () => requestHeaderPanel( { panel: 'publish', siteId: site.id, view: 'publish' } ) );

		expect( await screen.findByText( 'Where do you want to publish?' ) ).toBeInTheDocument();
	} );

	it( 'opens Share and returns focus to its fixed header button', async () => {
		await renderActions();
		const actions = userEvent.setup();
		const share = screen.getByRole( 'button', { name: 'Share' } );
		await actions.click( share );
		await screen.findByRole( 'dialog' );
		await actions.keyboard( '{Escape}' );
		await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
		await waitFor( () => expect( share ).toHaveFocus() );
	} );
} );
