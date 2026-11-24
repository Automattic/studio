import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeConnector, makeSite } from '@/test/fake-connector';
import { renderApp } from '@/test/render';
import type { Connector } from '@/data/core';

const TITLE = 'Usage statistics are changing';

function launch( overrides: Partial< Connector > = {}, sites = [ makeSite() ] ) {
	let pending = true;
	const view = renderApp( {
		connector: createFakeConnector(
			{ sites },
			{
				getUsageNoticePending: async () => pending,
				setUsageNoticeSeen: async () => {
					pending = false;
				},
				...overrides,
			}
		),
	} );
	return view;
}

describe( 'Usage notice', () => {
	it( 'tells people onboarded before the change, and Got it marks it seen for good', async () => {
		const { connector, unmount } = launch();
		const notice = await screen.findByRole( 'alertdialog', { name: TITLE } );
		expect( within( notice ).getByText( /stats are now linked to your account/ ) ).toBeVisible();

		fireEvent.click( within( notice ).getByRole( 'button', { name: 'Learn more…' } ) );
		expect( connector.openExternalUrl ).toHaveBeenCalledWith(
			'https://wordpress.studio/docs/telemetry/'
		);

		fireEvent.click( within( notice ).getByRole( 'button', { name: 'Got it' } ) );
		await waitFor( () =>
			expect( screen.queryByRole( 'alertdialog', { name: TITLE } ) ).not.toBeInTheDocument()
		);
		expect( connector.setUsageNoticeSeen ).toHaveBeenCalledTimes( 1 );

		unmount();
		connector.getUsageNoticePending.mockClear();
		renderApp( { connector } );
		await waitFor( () => expect( connector.getUsageNoticePending ).toHaveBeenCalled() );
		await screen.findAllByText( 'My site' );
		expect( screen.queryByRole( 'alertdialog', { name: TITLE } ) ).not.toBeInTheDocument();
	} );

	it.each( [ 'Open Settings', 'Settings' ] )(
		'%s marks it seen and lands on the usage statistics toggle',
		async ( label ) => {
			const { connector, history } = launch();
			const notice = await screen.findByRole( 'alertdialog', { name: TITLE } );

			fireEvent.click( within( notice ).getByRole( 'button', { name: label } ) );

			const toggle = await screen.findByRole( 'switch', {
				name: 'Improve WordPress Studio for everyone',
			} );
			await waitFor( () => expect( toggle ).toHaveFocus() );
			expect( history.location.search ).toContain( 'settings=general' );
			expect( connector.setUsageNoticeSeen ).toHaveBeenCalledTimes( 1 );
			expect( screen.queryByRole( 'alertdialog', { name: TITLE } ) ).not.toBeInTheDocument();
		}
	);

	it( 'is not shown to someone who is not due it', async () => {
		const { connector } = launch( { getUsageNoticePending: async () => false } );
		await waitFor( () => expect( connector.getUsageNoticePending ).toHaveBeenCalled() );
		await screen.findAllByText( 'My site' );
		expect( screen.queryByRole( 'alertdialog', { name: TITLE } ) ).not.toBeInTheDocument();
	} );

	it( 'is not shown during onboarding', async () => {
		launch( { getOnboardingCompleted: async () => false }, [] );
		await screen.findByRole( 'dialog', { name: 'Welcome to WordPress Studio' } );
		expect( screen.queryByRole( 'alertdialog', { name: TITLE } ) ).not.toBeInTheDocument();
	} );
} );
