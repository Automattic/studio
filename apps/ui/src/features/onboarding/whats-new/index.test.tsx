import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeConnector, makeSite } from '@/test/fake-connector';
import { renderApp, renderWithProviders } from '@/test/render';
import { getWhatsNewContent, WHATS_NEW_VERSION } from './content';
import { shouldShowWhatsNew } from './use-whats-new-autostart';
import { WhatsNewDialog } from './index';

const base = {
	siteCount: 1,
	agenticReady: true,
	hints: {},
	dialogOpen: false,
	guideOpen: false,
	alreadyStarted: false,
};

describe( 'What’s New', () => {
	it( 'shows unseen editions independently of legacy tour state', () => {
		expect( shouldShowWhatsNew( base ) ).toBe( true );
		expect( shouldShowWhatsNew( { ...base, hints: { tourDismissedVersion: 2 } } ) ).toBe( true );
		expect(
			shouldShowWhatsNew( { ...base, hints: { whatsNewSeenVersion: WHATS_NEW_VERSION - 1 } } )
		).toBe( true );
		expect(
			shouldShowWhatsNew( { ...base, hints: { whatsNewSeenVersion: WHATS_NEW_VERSION } } )
		).toBe( false );
		expect(
			shouldShowWhatsNew( { ...base, hints: { whatsNewSeenVersion: WHATS_NEW_VERSION + 1 } } )
		).toBe( false );
	} );

	it.each( [
		{ siteCount: 0 },
		{ agenticReady: false },
		{ hints: undefined },
		{ dialogOpen: true },
		{ guideOpen: true },
		{ alreadyStarted: true },
	] )( 'waits for the workspace: %j', ( override ) => {
		expect( shouldShowWhatsNew( { ...base, ...override } ) ).toBe( false );
	} );

	it.each( [ 'Done', 'Close', 'Escape' ] )(
		'reopens from the Help menu and remembers dismissal with %s',
		async ( action ) => {
			const { connector, user } = renderApp( {
				connector: createFakeConnector(
					{ sites: [ makeSite() ] },
					{ getOnboardingHints: async () => ( { whatsNewSeenVersion: WHATS_NEW_VERSION } ) }
				),
				path: '/sites/site-1',
			} );
			await screen.findByRole( 'group', { name: 'Sites' } );
			act( () => connector.emit( 'onShowWhatsNew' ) );
			await screen.findByRole( 'dialog', { name: 'What’s New in Studio' } );
			expect( screen.getByRole( 'button', { name: 'Done' } ) ).toHaveFocus();
			expect( screen.queryByRole( 'button', { name: 'Next' } ) ).not.toBeInTheDocument();
			expect( screen.queryByRole( 'button', { name: 'Learn more' } ) ).not.toBeInTheDocument();
			if ( action === 'Escape' ) await user.keyboard( '{Escape}' );
			else fireEvent.click( screen.getByRole( 'button', { name: action } ) );
			await waitFor( () =>
				expect(
					screen.queryByRole( 'dialog', { name: 'What’s New in Studio' } )
				).not.toBeInTheDocument()
			);
			expect( connector.setOnboardingHints ).toHaveBeenCalledWith( {
				whatsNewSeenVersion: WHATS_NEW_VERSION,
			} );
		}
	);

	it.each( [ true, false ] )(
		'replaces Settings when its Help action is selected (has sites: %s)',
		async ( hasSites ) => {
			const { history } = renderApp( {
				connector: createFakeConnector( { sites: hasSites ? [ makeSite() ] : [] } ),
				path: hasSites ? '/sites/site-1?settings=general' : '/sites?settings=general',
			} );
			await screen.findByRole( 'dialog', { name: 'Settings' } );
			fireEvent.click( await screen.findByRole( 'button', { name: 'View' } ) );
			await screen.findByRole( 'dialog', { name: 'What’s New in Studio' } );
			expect( screen.queryByRole( 'dialog', { name: 'Settings' } ) ).not.toBeInTheDocument();
			expect( history.location.search ).not.toContain( 'settings=' );
			expect( history.location.search ).not.toContain( 'addSite=' );
		}
	);

	it( 'opens the optional announcement link through the host', async () => {
		const { connector } = renderWithProviders(
			<WhatsNewDialog
				content={ { ...getWhatsNewContent(), learnMoreUrl: 'https://wordpress.com/blog/studio/' } }
				onClose={ () => {} }
			/>
		);
		fireEvent.click( await screen.findByRole( 'button', { name: 'Learn more' } ) );
		expect( connector.openExternalUrl ).toHaveBeenCalledWith(
			'https://wordpress.com/blog/studio/'
		);
	} );

	it( 'cancels a scheduled announcement while Settings is open, then shows it once', async () => {
		const { connector, history } = renderApp( {
			connector: createFakeConnector(
				{ sites: [ makeSite() ] },
				{ getOnboardingHints: async () => ( {} ) }
			),
			path: '/sites/site-1',
		} );
		await screen.findByRole( 'group', { name: 'Sites' } );
		act( () => history.push( '/sites/site-1?settings=general' ) );
		await screen.findByRole( 'dialog', { name: 'Settings' } );
		await act( () => new Promise( ( resolve ) => setTimeout( resolve, 600 ) ) );
		expect(
			screen.queryByRole( 'dialog', { name: 'What’s New in Studio' } )
		).not.toBeInTheDocument();
		act( () => history.push( '/sites/site-1' ) );
		await screen.findByRole( 'dialog', { name: 'What’s New in Studio' } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Done' } ) );
		await act( () => new Promise( ( resolve ) => setTimeout( resolve, 600 ) ) );
		expect(
			screen.queryByRole( 'dialog', { name: 'What’s New in Studio' } )
		).not.toBeInTheDocument();
		expect( connector.setOnboardingHints ).toHaveBeenCalledTimes( 1 );
	} );
} );
