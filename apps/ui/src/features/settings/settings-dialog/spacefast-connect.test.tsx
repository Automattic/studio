import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { aiSettings, createFakeConnector, makeSite } from '@/test/fake-connector';
import { renderApp } from '@/test/render';

const signIn = {
	url: 'https://auth.example.test/spacefast',
	code: 'ABCD-EFGH',
	handoff: { deviceCode: 'device-1' },
};

async function setup() {
	const connector = createFakeConnector( { sites: [ makeSite( { id: 'one' } ) ] } );
	connector.startProviderConnect.mockResolvedValue( signIn );
	renderApp( { connector, path: '/sites/one?settings=providers' } );
	const row = await screen.findByRole( 'group', { name: 'Spacefast' } );
	const button = within( row ).getByRole( 'button', { name: 'Connect' } );
	await waitFor( () => expect( button ).toBeEnabled() );
	return { connector, row, button };
}

const findDialog = () => screen.findByRole( 'dialog', { name: 'Connect to Spacefast' } );

describe( 'Spacefast connection in Providers', () => {
	it( 'shows the code in a dialog and returns to Providers on close and approval', async () => {
		const { connector, row, button } = await setup();
		let approve!: () => void;
		connector.connectProvider.mockReturnValue(
			new Promise( ( resolve ) => {
				approve = () => {
					const settings = aiSettings( 'wpcom', [ 'wpcom', 'spacefast' ] );
					connector.getAiSettings.mockResolvedValue( settings );
					resolve( settings );
				};
			} )
		);

		fireEvent.click( button );
		const dialog = await findDialog();
		expect( await within( dialog ).findByText( signIn.code ) ).toBeVisible();
		expect( screen.queryByRole( 'dialog', { name: 'Settings' } ) ).not.toBeInTheDocument();
		expect( row ).toHaveTextContent( 'Publish a static copy of your sites to a Spacefast Space.' );
		expect( row ).not.toHaveTextContent( signIn.code );
		expect( connector.openExternalUrl ).not.toHaveBeenCalled();
		fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Copy code' } ) );
		expect( await within( dialog ).findByRole( 'button', { name: 'Copied' } ) ).toBeVisible();
		expect( connector.copyText ).toHaveBeenCalledWith( signIn.code );
		fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Open Spacefast' } ) );
		expect( connector.openExternalUrl ).toHaveBeenCalledWith( signIn.url );
		expect( await within( dialog ).findByText( 'Waiting for approval…' ) ).toBeVisible();
		expect( connector.connectProvider ).toHaveBeenCalledWith(
			'spacefast',
			'sign-in',
			signIn.handoff
		);

		fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Close' } ) );
		expect( await screen.findByRole( 'tab', { name: 'Providers', selected: true } ) ).toBeVisible();
		const returnedRow = await screen.findByRole( 'group', { name: 'Spacefast' } );
		const returnedButton = within( returnedRow ).getByRole( 'button', { name: 'Connect' } );
		await waitFor( () => expect( returnedButton ).toHaveFocus() );
		expect(
			screen.queryByRole( 'dialog', { name: 'Connect to Spacefast' } )
		).not.toBeInTheDocument();

		fireEvent.click( returnedButton );
		const reopenedDialog = await findDialog();
		expect( await within( reopenedDialog ).findByText( signIn.code ) ).toBeVisible();
		expect( within( reopenedDialog ).getByText( 'Waiting for approval…' ) ).toBeVisible();
		expect( connector.startProviderConnect ).toHaveBeenCalledTimes( 1 );
		await act( async () => approve() );
		const connectedRow = await screen.findByRole( 'group', { name: 'Spacefast' } );
		expect( await within( connectedRow ).findByText( 'Connected' ) ).toBeVisible();
		await waitFor( () =>
			expect( within( connectedRow ).getByRole( 'button', { name: 'Disconnect' } ) ).toHaveFocus()
		);
		expect(
			screen.queryByRole( 'dialog', { name: 'Connect to Spacefast' } )
		).not.toBeInTheDocument();
	} );

	it( 'lets the user retry a failed sign-in from the dialog', async () => {
		const { connector, button } = await setup();
		connector.connectProvider
			.mockRejectedValueOnce( new Error( 'The Spacefast sign-in expired. Try again.' ) )
			.mockReturnValueOnce( new Promise( () => {} ) );
		fireEvent.click( button );
		const dialog = await findDialog();
		expect( await within( dialog ).findByRole( 'alert' ) ).toHaveTextContent( 'sign-in expired' );
		fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Try again' } ) );
		expect( await within( dialog ).findByText( signIn.code ) ).toBeVisible();
		expect( connector.startProviderConnect ).toHaveBeenCalledTimes( 2 );
	} );
} );
