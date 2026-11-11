import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { setCommandPaletteOpen } from '@/data/use-command-palette';
import {
	createFakeConnector,
	makeSession,
	makeSite,
	TEST_USER,
	type FakeConnectorInitialState,
} from '@/test/fake-connector';
import { renderApp } from '@/test/render';
import {
	assistantToolCallEntry,
	promptEntry,
	toolResultEntry,
	turnClosedEntry,
} from '@/test/session-entries';

const isApple = /Mac|iPhone|iPad/.test( navigator.platform );
const site = makeSite( { id: 'one', name: 'Test site' } );

async function openFeedback( {
	path = '/sites/one',
	...state
}: FakeConnectorInitialState & { path?: string } = {} ) {
	const connector = createFakeConnector( { sites: [ site ], user: TEST_USER, ...state } );
	const view = renderApp( { connector, path } );
	await waitFor( () => expect( view.history.location.pathname ).toBe( path ) );
	await screen.findByRole( 'group', { name: 'Sites' } );
	fireEvent.keyDown( document, { code: 'KeyK', key: 'k', metaKey: isApple, ctrlKey: ! isApple } );
	const input = await screen.findByRole( 'combobox', { name: 'Search commands' } );
	fireEvent.change( input, { target: { value: 'feedback' } } );
	fireEvent.click( screen.getByRole( 'option', { name: /Send feedback/ } ) );
	const dialog = await screen.findByRole( 'dialog', { name: /Send feedback|Feedback sent/ } );
	return { ...view, connector, dialog };
}

afterEach( () => act( () => setCommandPaletteOpen( false ) ) );

describe( 'FeedbackDialog', () => {
	it( 'sends the typed message and shows the reference ID', async () => {
		const { connector, dialog, user } = await openFeedback();
		connector.sendFeedback.mockResolvedValue( { feedbackId: 1018 } );
		const send = within( dialog ).getByRole( 'button', { name: 'Send' } );
		expect( send ).toBeDisabled();
		await user.type(
			within( dialog ).getByRole( 'textbox', { name: 'Message' } ),
			'The preview did not reload.'
		);
		expect( send ).toBeEnabled();
		expect( within( dialog ).getByText( 'Choose a topic' ) ).toBeInTheDocument();
		fireEvent.click( send );
		await screen.findByText( '1018', { selector: 'strong' } );
		expect( connector.sendFeedback ).toHaveBeenCalledWith( {
			type: 'general',
			message: 'The preview did not reload.',
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Done' } ) );
		await waitFor( () =>
			expect( screen.queryByRole( 'dialog', { name: 'Feedback sent' } ) ).not.toBeInTheDocument()
		);
	} );

	it( 'includes optional areas without a topic', async () => {
		const { connector, dialog, user } = await openFeedback();
		connector.sendFeedback.mockResolvedValue( { feedbackId: 42 } );
		expect(
			within( dialog ).queryByRole( 'group', { name: 'Feedback areas' } )
		).toBeInTheDocument();
		const preview = within( dialog ).getByRole( 'button', { name: 'Preview' } );
		await user.click( preview );
		await user.click( within( dialog ).getByRole( 'button', { name: 'Sync' } ) );
		await user.click( preview );
		expect( preview ).toHaveAttribute( 'aria-pressed', 'false' );
		await user.click( preview );
		await user.type( within( dialog ).getByRole( 'textbox', { name: 'Message' } ), 'It broke.' );
		await user.click( within( dialog ).getByRole( 'button', { name: 'Send' } ) );
		await waitFor( () =>
			expect( connector.sendFeedback ).toHaveBeenCalledWith( {
				type: 'general',
				message: 'Areas: Preview, Sync\n\nIt broke.',
			} )
		);
	} );

	it( 'shows the service error and keeps the message', async () => {
		const { connector, dialog, user } = await openFeedback();
		connector.sendFeedback.mockRejectedValue( new Error( 'Rate limited.' ) );
		const message = within( dialog ).getByRole( 'textbox', { name: 'Message' } );
		await user.type( message, 'It broke.' );
		await user.click( within( dialog ).getByRole( 'combobox', { name: 'Feedback type' } ) );
		await user.click( await screen.findByRole( 'option', { name: 'Bug report' } ) );
		fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Send' } ) );
		await within( dialog ).findByText( 'Rate limited.' );
		expect( message ).toHaveValue( 'It broke.' );
	} );

	it( 'offers the GitHub form and login when signed out', async () => {
		const { connector, dialog } = await openFeedback( { user: null } );
		expect( within( dialog ).queryByRole( 'button', { name: 'Send' } ) ).not.toBeInTheDocument();
		fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Open GitHub' } ) );
		expect( connector.openExternalUrl ).toHaveBeenCalledWith(
			expect.stringContaining( 'github.com/Automattic/studio/issues' )
		);
		expect( connector.sendFeedback ).not.toHaveBeenCalled();
	} );

	it( 'can append the open chat’s transcript', async () => {
		const { connector, dialog, user } = await openFeedback( {
			path: '/sessions/chat-1',
			sessions: [
				{
					summary: makeSession( { id: 'chat-1', ownerSiteId: 'one', title: 'Theme switch' } ),
					entries: [
						promptEntry( 'Switch themes' ),
						assistantToolCallEntry( 'wp_cli', { command: 'theme activate x' } ),
						toolResultEntry( 'Error: Theme not found.', true ),
						turnClosedEntry( 'success' ),
					],
				},
			],
		} );
		connector.sendFeedback.mockResolvedValue( { feedbackId: 7 } );
		await user.click( within( dialog ).getByRole( 'combobox', { name: 'Feedback type' } ) );
		await user.click( await screen.findByRole( 'option', { name: 'General feedback' } ) );
		await user.type( within( dialog ).getByRole( 'textbox', { name: 'Message' } ), 'See chat.' );
		fireEvent.click( within( dialog ).getByRole( 'checkbox', { name: /Include this chat/ } ) );
		fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Send' } ) );
		await screen.findByText( '7', { selector: 'strong' } );
		const [ sent ] = connector.sendFeedback.mock.calls[ 0 ];
		expect( sent.message ).toBe(
			[
				'See chat.',
				'',
				'--- Chat transcript ---',
				'User: Switch themes',
				'Tool wp_cli failed: Error: Theme not found.',
			].join( '\n' )
		);
	} );
} );
