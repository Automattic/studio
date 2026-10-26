import { ADD_PAYMENT_METHOD_URL } from '@studio/common/lib/studio-assistant-quota';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { createFakeConnector, makeSession, makeSite } from '@/test/fake-connector';
import { renderApp } from '@/test/render';
import type { AiSettings } from '@studio/common/ai/providers';

const COMPOSER = { name: 'Message WordPress Studio' };

function anthropicRow( dialog: HTMLElement ) {
	return within(
		within( dialog ).getByText( 'Anthropic', { exact: true } ).closest( '[data-settings-row]' )!
	);
}

beforeEach( () => {
	localStorage.clear();
} );

it.each( [
	{ provider: 'wpcom' as const, payment: false, gated: true },
	{ provider: 'wpcom' as const, payment: true, gated: false },
	{ provider: 'wpcom' as const, payment: null, gated: false },
	{ provider: 'anthropic-api-key' as const, payment: false, gated: false },
] )(
	'checks payment access for $provider with payment=$payment',
	async ( { provider, payment, gated } ) => {
		const quota =
			payment === null
				? null
				: {
						costUsage: 0,
						costCap: 500000,
						costResetDate: '',
						emailVerified: true,
						hasPaymentMethod: payment,
						studioCodeAiHasAccess: true,
						studioCodeAiAccess: 'granted' as const,
						allowanceRemaining: 100,
						purchasedRemaining: 0,
						purchasedAtTopUp: 0,
				  };
		const connector = createFakeConnector(
			{ sites: [ makeSite( { id: 'one', path: '/sites/my-site' } ) ] },
			{
				getAiSettings: async () => ( {
					provider,
					hasAnthropicApiKey: true,
					anthropicApiKeyPreview: 'test',
				} ),
				getStudioAssistantQuota: async () => quota,
			}
		);
		renderApp( { connector, path: '/sites/one/new' } );
		await screen.findByRole( 'button', { name: 'Site actions for My site' } );
		const input = await screen.findByRole( 'combobox', COMPOSER );
		if ( gated ) {
			const addPayment = await screen.findByRole( 'button', { name: 'Set up' } );
			expect( input ).toBeEnabled();
			expect( screen.getByRole( 'button', { name: 'Send message' } ) ).toBeDisabled();
			fireEvent.click( addPayment );
			expect( connector.openExternalUrl ).toHaveBeenCalledWith( ADD_PAYMENT_METHOD_URL );
			expect( connector.continueSession ).not.toHaveBeenCalled();
			connector.getStudioAssistantQuota.mockResolvedValue( { ...quota!, hasPaymentMethod: true } );
			fireEvent.focus( window, { relatedTarget: input } );
			await waitFor( () => expect( input ).toBeEnabled() );
			await waitFor( () =>
				expect( screen.queryByRole( 'button', { name: 'Set up' } ) ).not.toBeInTheDocument()
			);
		} else {
			await waitFor( () => expect( input ).toBeEnabled() );
			await waitFor( () =>
				expect( screen.queryByRole( 'button', { name: 'Set up' } ) ).not.toBeInTheDocument()
			);
		}
	}
);

it.each( [ false, true ] )(
	'connects a personal key without WordPress.com login (saved=%s)',
	async ( saved ) => {
		let connection: AiSettings = {
			provider: 'wpcom',
			hasAnthropicApiKey: saved,
			anthropicApiKeyPreview: saved ? 'test' : null,
		};
		const site = makeSite( { id: 'one', path: '/sites/my-site' } );
		const connector = createFakeConnector(
			{
				user: null,
				sites: [ site ],
				sessions: [
					{
						summary: makeSession( {
							id: 'key-chat',
							ownerSiteId: 'one',
							ownerSitePath: site.path,
						} ),
						entries: [],
					},
				],
			},
			{
				getAiSettings: async () => connection,
				saveAnthropicApiKey: async () => {
					connection = { ...connection, hasAnthropicApiKey: true, anthropicApiKeyPreview: 'test' };
					return connection;
				},
				setAiProvider: async ( provider ) => {
					connection = { ...connection, provider };
					return connection;
				},
				continueSession: async () => ( { runId: 'key-run' } ),
			}
		);
		renderApp( { connector, path: '/sessions/key-chat' } );
		await screen.findByRole( 'button', { name: 'Site actions for My site' } );
		const draftInput = await screen.findByRole( 'combobox', COMPOSER );
		fireEvent.change( draftInput, { target: { value: 'Update my site' } } );
		await screen.findByRole( 'button', { name: 'Connect' } );
		expect( draftInput ).toBeEnabled();
		expect( screen.getByRole( 'button', { name: 'Send message' } ) ).toBeEnabled();
		fireEvent.click( screen.getByRole( 'button', { name: 'Send message' } ) );
		expect( draftInput ).toHaveValue( 'Update my site' );
		expect( connector.createSession ).not.toHaveBeenCalled();
		expect( connector.continueSession ).not.toHaveBeenCalled();
		expect( screen.queryByText( 'Checking access…' ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Check again' } ) ).not.toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'button', { name: 'Connect' } ) );
		const dialog = await screen.findByRole( 'dialog', { name: 'Settings' } );
		fireEvent.click(
			anthropicRow( dialog ).getByRole( 'button', { name: saved ? 'Manage' : 'Connect' } )
		);
		if ( ! saved ) {
			const keyInput = await screen.findByLabelText( 'Anthropic API key', { selector: 'input' } );
			expect( keyInput ).toHaveAttribute( 'type', 'password' );
			fireEvent.change( keyInput, { target: { value: '  test-key  ' } } );
		}
		fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Save' } ) );
		await waitFor( () =>
			expect( connector.setAiProvider ).toHaveBeenCalledWith( 'anthropic-api-key' )
		);
		await waitFor( () =>
			expect( anthropicRow( dialog ).getByRole( 'button', { name: 'Manage' } ) ).toBeEnabled()
		);
		fireEvent.click( within( dialog ).getByRole( 'button', { name: 'Close settings' } ) );
		await waitFor( () =>
			expect( screen.getByRole( 'button', { name: 'Send message' } ) ).toBeEnabled()
		);
		const input = screen.getByRole( 'combobox', COMPOSER );
		expect( input ).toHaveValue( 'Update my site' );
		expect( connector.setAiProvider ).toHaveBeenCalledWith( 'anthropic-api-key' );
		expect( connector.authenticate ).not.toHaveBeenCalled();
		fireEvent.change( input, { target: { value: 'Update my site' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Send message' } ) );
		await waitFor( () =>
			expect( connector.continueSession ).toHaveBeenCalledWith(
				'key-chat',
				'Update my site',
				expect.anything()
			)
		);
	}
);
