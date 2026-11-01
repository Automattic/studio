import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { PublishButton, SiteDeliveryDialog } from '@/features/site-delivery';
import { createFakeConnector, makeSite, TEST_USER } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import type { Connector } from '@/data/core';

const SPACE = {
	id: 'space-1',
	title: 'Trattoria',
	slug: 'trattoria',
	liveUrl: 'https://trattoria.view.fast',
	teamId: 'team-1',
	teamName: 'Riad',
};

function setup( overrides: Partial< Connector > = {}, user: typeof TEST_USER | null = TEST_USER ) {
	const site = makeSite();
	const connector = createFakeConnector(
		{ sites: [ site ], user },
		{
			isSpacefastSignedIn: async () => true,
			listSpacefastSpaces: async () => [ SPACE ],
			listSpacefastTeams: async () => [ { id: 'team-1', name: 'Riad' } ],
			...overrides,
		}
	);
	renderWithProviders(
		<>
			<SiteDeliveryDialog site={ site } />
			<PublishButton site={ site } />
		</>,
		{ connector }
	);
	return { connector, site };
}

describe( 'Spacefast publishing', () => {
	it( 'publishes to the picked Space from its own tab', async () => {
		const { connector, site } = setup();
		const actions = userEvent.setup();
		await actions.click( await screen.findByRole( 'button', { name: 'Publish…' } ) );
		await actions.click( await screen.findByRole( 'tab', { name: 'Spacefast' } ) );
		await actions.click( await screen.findByRole( 'option', { name: /Trattoria/ } ) );
		expect( connector.publishToSpacefast ).toHaveBeenCalledWith( site.id, {
			spaceId: 'space-1',
		} );
	} );

	it( 'creates a Space named after the site in the first team', async () => {
		const { connector, site } = setup();
		const actions = userEvent.setup();
		await actions.click( await screen.findByRole( 'button', { name: 'Publish…' } ) );
		await actions.click( await screen.findByRole( 'tab', { name: 'Spacefast' } ) );
		await actions.click( await screen.findByRole( 'option', { name: /New Space/ } ) );
		expect( connector.publishToSpacefast ).toHaveBeenCalledWith( site.id, {
			teamId: 'team-1',
			title: site.name,
		} );
	} );

	it( 'hides the tab until Spacefast is connected', async () => {
		setup( { isSpacefastSignedIn: async () => false } );
		const actions = userEvent.setup();
		await actions.click( await screen.findByRole( 'button', { name: 'Publish…' } ) );
		await screen.findByRole( 'tab', { name: 'Publish' } );
		expect( screen.queryByRole( 'tab', { name: 'Spacefast' } ) ).not.toBeInTheDocument();
	} );

	it( 'opens Spacefast without a WordPress.com account', async () => {
		setup( {}, null );
		const actions = userEvent.setup();
		await actions.click( await screen.findByRole( 'button', { name: 'Publish…' } ) );
		expect( await screen.findByRole( 'tab', { name: 'Spacefast' } ) ).toHaveAttribute(
			'aria-selected',
			'true'
		);
	} );
} );
