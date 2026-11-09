import { AI_MODELS } from '@studio/agent/protocol/models';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Composer } from '@/features/composer';
import { createFakeConnector, type FakeConnector } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import type { AiModelId } from '@/data/core';
import type { StudioAssistantQuota } from '@studio/common/lib/studio-assistant-quota';

const allFavorites = AI_MODELS.map( ( model ) => ( {
	provider: model.family === 'studio' ? 'wpcom' : 'anthropic-api-key',
	model: model.id,
	effort: 'default' as const,
} ) );

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
		{ preferences: { modelFavorites: allFavorites } },
		{
			getAiSettings: async () => ( {
				provider: anthropic ? 'anthropic-api-key' : 'wpcom',
				hasAnthropicApiKey: anthropic,
				anthropicApiKeyPreview: null,
			} ),
			getStudioAssistantQuota: quota,
			getStudioAssistantTopUpPricing: async () =>
				( { options: [ { credits: 100000, display: '$10' } ] } ) as never,
		}
	);
}

async function renderPicker( model: AiModelId, connector: FakeConnector, onModelChange = vi.fn() ) {
	const view = renderWithProviders(
		<Composer
			busy={ false }
			model={ model }
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
		const { trigger } = await renderPicker( 'claude-opus-5', connectorFor( { anthropic: true } ) );
		fireEvent.click( trigger );
		const current = await screen.findByRole( 'button', { name: /^Opus 5$/ } );
		expect( current ).toHaveAttribute( 'aria-pressed', 'true' );
		expect( current ).toHaveAccessibleDescription(
			'Plan complex builds and solve harder problems'
		);
	} );

	it( 'lists the tiers and closes after selection', async () => {
		const { trigger, onModelChange } = await renderPicker( 'balanced', connectorFor() );
		fireEvent.click( trigger );
		expect( await screen.findByRole( 'button', { name: /^Fast/ } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: /^Balanced/ } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: /^Strong/ } ) ).toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'button', { name: /^Fast/ } ) );
		await waitFor( () => expect( onModelChange ).toHaveBeenCalledWith( 'fast', 'wpcom' ) );
		await waitFor( () =>
			expect( screen.queryByRole( 'dialog', { name: 'Choose a model' } ) ).not.toBeInTheDocument()
		);
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

	it( 'keeps provider setup and credit purchases outside the model picker', async () => {
		const { trigger } = await renderPicker( 'balanced', connectorFor() );
		fireEvent.click( trigger );
		await screen.findByRole( 'button', { name: 'Balanced' } );
		expect( screen.queryByRole( 'button', { name: /^Get more credits/ } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: /^Manage providers/ } ) ).not.toBeInTheDocument();
	} );
} );
