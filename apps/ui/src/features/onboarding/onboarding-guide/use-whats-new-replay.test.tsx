import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { createFakeConnector, makeSite } from '@/test/fake-connector';
import { renderApp } from '@/test/render';
import { WHATS_NEW_VERSION } from './whats-new';

it( 'opens the pages from Help ▸ What’s New and marks them seen when closed', async () => {
	const { connector } = renderApp( {
		connector: createFakeConnector( {
			sites: [ makeSite() ],
			preferences: { agenticFeaturesEnabled: false },
		} ),
		path: '/sites/site-1',
	} );
	await screen.findByRole( 'group', { name: 'Sites' } );
	act( () => connector.emit( 'onShowWhatsNew' ) );

	expect(
		await screen.findByRole( 'dialog', { name: 'Meet the new WordPress Studio' } )
	).toBeVisible();
	// Chat is off, so the Studio Code page is left out.
	expect( screen.queryByText( 'Studio Code, right beside your site' ) ).not.toBeInTheDocument();

	fireEvent.click( screen.getByRole( 'button', { name: 'Skip' } ) );
	await waitFor( () =>
		expect(
			screen.queryByRole( 'dialog', { name: 'Meet the new WordPress Studio' } )
		).not.toBeInTheDocument()
	);
	expect( connector.setOnboardingHints ).toHaveBeenCalledWith( {
		whatsNewSeenVersion: WHATS_NEW_VERSION,
	} );
} );
