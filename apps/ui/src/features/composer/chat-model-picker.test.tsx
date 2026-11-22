import { getProvider, type ProviderId } from '@studio/providers';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Composer } from '@/features/composer';
import { aiSettings, createFakeConnector, type FakeConnector } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import type { AiModelId } from '@/data/core';
import type { StudioAssistantQuota } from '@studio/common/lib/studio-assistant-quota';

const paidQuota: StudioAssistantQuota = {
	costCap: 1000,
	costUsage: 0,
	allowanceRemaining: 1000,
	purchasedRemaining: 500,
	purchasedAtTopUp: 500,
	hasPaymentMethod: true,
} as StudioAssistantQuota;

const allowanceQuota: StudioAssistantQuota = {
	costCap: 1000,
	costResetDate: undefined,
	studioCodeAiHasAccess: undefined,
	studioCodeAiAccess: undefined,
	costUsage: 400,
	allowanceRemaining: 600,
	purchasedRemaining: 0,
	purchasedAtTopUp: 0,
	emailVerified: true,
	hasPaymentMethod: true,
};

function connectorFor( {
	anthropic = false,
	quota = async () => paidQuota,
}: { anthropic?: boolean; quota?: () => Promise< StudioAssistantQuota | null > } = {} ) {
	return createFakeConnector(
		{},
		{
			getAiSettings: async () =>
				aiSettings( 'wpcom', anthropic ? [ 'wpcom', 'anthropic' ] : [ 'wpcom' ] ),
			getStudioAssistantQuota: quota,
			getStudioAssistantTopUpPricing: async () =>
				( { options: [ { credits: 100000, display: '$10' } ] } ) as never,
		}
	);
}

async function renderPicker(
	model: AiModelId,
	connector: FakeConnector,
	onModelChange = vi.fn(),
	provider?: ProviderId
) {
	const view = renderWithProviders(
		<Composer
			busy={ false }
			model={ model }
			provider={ provider }
			sessionId="test"
			entries={ [] }
			onSend={ vi.fn() }
			onInterrupt={ vi.fn() }
			onModelChange={ onModelChange }
		/>,
		{ connector }
	);
	const trigger = await screen.findByRole( 'button', { name: 'Model' } );
	await waitFor( () => expect( connector.getStudioAssistantQuota ).toHaveBeenCalled() );
	return { ...view, trigger, onModelChange };
}

describe( 'Chat model picker', () => {
	it( 'opens with the current model selected for keyboard navigation', async () => {
		const { trigger } = await renderPicker(
			'claude-opus-5-5',
			connectorFor( { anthropic: true } ),
			undefined,
			'anthropic'
		);
		fireEvent.click( trigger );
		const current = await screen.findByRole( 'button', { name: 'Opus 5.5' } );
		expect( current ).toHaveAttribute( 'aria-pressed', 'true' );
		expect( current ).toHaveAccessibleDescription(
			'Anthropic · Plan complex builds and solve harder problems'
		);
	} );

	it( 'offers to manage usage only when Anthropic connects with a Claude subscription', async () => {
		const connectedWith = ( method: 'api-key' | 'setup-token' ) => {
			const settings = aiSettings( 'anthropic', [ 'anthropic' ] );
			settings.accounts.anthropic = {
				connected: true,
				...getProvider( 'anthropic' ).account.describe(
					method === 'api-key'
						? { method, apiKey: 'sk-ant-api03-test' }
						: { method, token: 'sk-ant-oat01-test' }
				),
			};
			return createFakeConnector( {}, { getAiSettings: async () => settings } );
		};
		const subscription = await renderPicker( 'claude-opus-5-5', connectedWith( 'setup-token' ) );
		fireEvent.click( subscription.trigger );
		expect( await screen.findByRole( 'button', { name: /Manage usage/ } ) ).toHaveTextContent(
			'Using Claude plan'
		);
		subscription.unmount();

		const apiKey = await renderPicker( 'claude-opus-5-5', connectedWith( 'api-key' ) );
		fireEvent.click( apiKey.trigger );
		await screen.findByRole( 'button', { name: 'Opus 5.5' } );
		expect( screen.queryByRole( 'button', { name: /Manage usage/ } ) ).not.toBeInTheDocument();
	} );

	it( 'offers only the models the connected account can run', async () => {
		const settings = aiSettings( 'github-copilot', [ 'github-copilot' ] );
		settings.accounts[ 'github-copilot' ] = {
			connected: true,
			...getProvider( 'github-copilot' ).account.describe( {
				method: 'github',
				githubToken: 'gho_1',
				copilotToken: 'copilot',
				copilotTokenExpiresAt: Date.now() + 60_000,
				models: [ 'claude-sonnet-5-5' ],
			} ),
		};
		const { trigger } = await renderPicker(
			'claude-sonnet-5-5',
			createFakeConnector( {}, { getAiSettings: async () => settings } )
		);
		fireEvent.click( trigger );
		await screen.findByRole( 'button', { name: 'Sonnet 5.5' } );
		expect( screen.queryByRole( 'button', { name: /Gemini/ } ) ).not.toBeInTheDocument();
	} );

	it( 'lists the tiers and keeps the picker open after selection', async () => {
		const { trigger, onModelChange } = await renderPicker( 'balanced', connectorFor() );
		fireEvent.click( trigger );
		expect( await screen.findByRole( 'button', { name: /^Fast/ } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: /^Balanced/ } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: /^Strong/ } ) ).toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'button', { name: /^Fast/ } ) );
		await waitFor( () =>
			expect( onModelChange ).toHaveBeenCalledWith( 'fast', 'wpcom', 'default' )
		);
		expect( screen.getByRole( 'textbox', { name: 'Search models' } ) ).toBeVisible();
	} );

	it( 'keeps paid models locked', async () => {
		const connector = connectorFor( {
			quota: async () => ( { ...paidQuota, purchasedRemaining: 0, purchasedAtTopUp: 0 } ),
		} );
		const { trigger, onModelChange } = await renderPicker( 'fast', connector );
		fireEvent.click( trigger );
		const strong = await screen.findByRole( 'button', { name: /^Strong/ } );
		await waitFor( () => expect( strong ).toBeDisabled() );
		fireEvent.click( strong );
		expect( onModelChange ).not.toHaveBeenCalled();
	} );

	it( 'shows legacy allowance without offering credit purchases', async () => {
		const { trigger } = await renderPicker(
			'fast',
			connectorFor( {
				quota: async () => ( {
					...allowanceQuota,
					allowanceRemaining: undefined,
					purchasedRemaining: undefined,
				} ),
			} )
		);
		await waitFor( () =>
			expect( trigger ).toHaveAttribute(
				'aria-description',
				'Fast · WordPress.com · AI allowance: 60% remaining'
			)
		);
		fireEvent.click( trigger );
		await screen.findByRole( 'button', { name: /^Fast/ } );
		expect( screen.queryByRole( 'button', { name: /^Get more credits/ } ) ).not.toBeInTheDocument();
	} );

	it( 'hides stale balance and purchase action on query failure', async () => {
		const { trigger } = await renderPicker(
			'fast',
			connectorFor( {
				quota: async () => {
					throw new Error( 'Usage unavailable' );
				},
			} )
		);
		await waitFor( () =>
			expect( trigger ).toHaveAttribute(
				'aria-description',
				'Fast · WordPress.com · AI usage unavailable'
			)
		);
		fireEvent.click( trigger );
		await screen.findByRole( 'button', { name: /^Fast/ } );
		expect( screen.queryByRole( 'button', { name: /^Get more credits/ } ) ).not.toBeInTheDocument();
	} );

	it( 'opens the existing purchase dialog from the model picker and continues to desktop checkout', async () => {
		const { connector, trigger } = await renderPicker(
			'fast',
			connectorFor( { quota: async () => allowanceQuota } )
		);
		fireEvent.click( trigger );
		const buy = await screen.findByRole( 'button', { name: /^Get more credits/ } );
		await waitFor( () => expect( buy ).not.toHaveAttribute( 'aria-disabled', 'true' ) );
		fireEvent.click( buy );
		expect( await screen.findByRole( 'heading', { name: 'Add AI credits' } ) ).toBeVisible();
		expect( screen.queryByRole( 'button', { name: /^Fast/ } ) ).not.toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'button', { name: /^Continue/ } ) );
		await waitFor( () =>
			expect( connector.openExternalUrl ).toHaveBeenCalledWith(
				expect.stringContaining( 'studioReturnTo=ai-credits-purchased' )
			)
		);
	} );
} );
