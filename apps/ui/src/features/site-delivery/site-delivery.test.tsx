import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createFakeConnector, makeSite, TEST_USER } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { PublishButton, ShareButton, SiteDeliveryProvider } from './index';

function setup() {
	const site = makeSite();
	const connector = createFakeConnector( { sites: [ site ], user: TEST_USER } );
	renderWithProviders(
		<SiteDeliveryProvider site={ site }>
			<ShareButton site={ site } />
			<PublishButton site={ site } />
		</SiteDeliveryProvider>,
		{ connector }
	);
	return connector;
}

describe( 'shared Share and Publish dialog', () => {
	it( 'opens each button’s tab and switches within the same dialog without starting an operation', async () => {
		const connector = setup();
		const actions = userEvent.setup();
		await actions.click( await screen.findByRole( 'button', { name: 'Share' } ) );
		const dialog = await screen.findByRole( 'dialog', { name: 'Share and publish' } );
		expect( screen.getByRole( 'tab', { name: 'Share' } ) ).toHaveAttribute(
			'aria-selected',
			'true'
		);
		await screen.findByRole( 'button', { name: 'Create preview' } );
		expect( connector.fetchSyncableWpcomSites ).not.toHaveBeenCalled();
		await actions.click( screen.getByRole( 'tab', { name: 'Publish' } ) );
		expect( await screen.findByRole( 'button', { name: 'New site…' } ) ).toBeVisible();
		expect( screen.getByRole( 'dialog' ) ).toBe( dialog );
		await actions.click( screen.getByRole( 'tab', { name: 'Share' } ) );
		expect( screen.getByRole( 'button', { name: 'Create preview' } ) ).toBeVisible();
		expect( connector.publishPreviewSite ).not.toHaveBeenCalled();
		expect( connector.openExternalUrl ).not.toHaveBeenCalled();
		await actions.click( screen.getByRole( 'button', { name: 'Close' } ) );
		await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
		await actions.click( screen.getByRole( 'button', { name: 'Publish…' } ) );
		expect( screen.getByRole( 'tab', { name: 'Publish' } ) ).toHaveAttribute(
			'aria-selected',
			'true'
		);
	} );

	it( 'supports arrow-key tab switching and restores focus to the opening button', async () => {
		setup();
		const actions = userEvent.setup();
		const trigger = await screen.findByRole( 'button', { name: 'Publish…' } );
		await actions.click( trigger );
		await waitFor( () => expect( screen.getByRole( 'tab', { name: 'Publish' } ) ).toHaveFocus() );
		await actions.keyboard( '{ArrowLeft}{Enter}' );
		expect( screen.getByRole( 'tab', { name: 'Share' } ) ).toHaveAttribute(
			'aria-selected',
			'true'
		);
		fireEvent.keyDown( screen.getByRole( 'tab', { name: 'Share' } ), { key: 'Escape' } );
		await waitFor( () => expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument() );
		expect( trigger ).toHaveFocus();
	} );
} );
