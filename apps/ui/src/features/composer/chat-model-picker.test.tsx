import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Composer } from '@/features/composer';
import { createFakeConnector, type FakeConnector } from '@/test/fake-connector';
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

function connectorFor( {
	anthropic = false,
	paid = true,
}: { anthropic?: boolean; paid?: boolean } = {} ) {
	return createFakeConnector(
		{},
		{
			getAiSettings: async () => ( {
				provider: 'wpcom',
				hasAnthropicApiKey: anthropic,
				anthropicApiKeyPreview: null,
			} ),
			getStudioAssistantQuota: async () =>
				paid ? paidQuota : { ...paidQuota, purchasedRemaining: 0, purchasedAtTopUp: 0 },
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
	it( 'identifies billing sources and opens provider setup', async () => {
		const { trigger, history } = await renderPicker( 'fast', connectorFor( { paid: false } ) );
		expect( trigger ).toHaveTextContent( 'Fast' );
		await waitFor( () =>
			expect( trigger ).toHaveAttribute(
				'title',
				expect.stringMatching( /^Fast · WordPress\.com/ )
			)
		);
		fireEvent.click( trigger );
		expect( await screen.findByRole( 'option', { name: /^Fast/ } ) ).toHaveTextContent(
			'WordPress · Quick fixes and questions'
		);
		expect( screen.getByText( 'Actions' ) ).toBeInTheDocument();
		expect( screen.queryByText( 'Models' ) ).not.toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'option', { name: /^Connect provider…/ } ) );
		await waitFor( () => expect( history.location.search ).toContain( 'settings=ai' ) );
	} );

	it( 'opens with the current model selected for keyboard navigation', async () => {
		const { trigger } = await renderPicker( 'claude-opus-5', connectorFor( { anthropic: true } ) );
		fireEvent.click( trigger );
		const current = await screen.findByRole( 'option', { name: /Opus 5/ } );
		expect( current ).toHaveAttribute( 'aria-selected', 'true' );
		expect( current ).toHaveTextContent( 'Claude · Plan complex builds and solve harder problems' );
	} );

	it( 'shows a simple anchored picker and closes after selection', async () => {
		const { trigger, onModelChange } = await renderPicker( 'balanced', connectorFor() );
		fireEvent.click( trigger );
		expect( await screen.findByRole( 'option', { name: /^Fast/ } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'option', { name: /^Balanced/ } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'option', { name: /^Strong/ } ) ).toBeInTheDocument();
		expect( screen.getByRole( 'dialog' ) ).not.toHaveAttribute( 'aria-modal', 'true' );
		expect( screen.getByRole( 'option', { name: /^Fast/ } ) ).toHaveTextContent(
			'Quick fixes and questions'
		);
		expect( screen.getByRole( 'option', { name: /^Strong/ } ) ).toHaveTextContent(
			'Plan complex builds and solve harder problems'
		);
		fireEvent.click( screen.getByRole( 'option', { name: /^Fast/ } ) );
		await waitFor( () => expect( onModelChange ).toHaveBeenCalledWith( 'fast' ) );
		await waitFor( () => expect( screen.queryByRole( 'option' ) ).not.toBeInTheDocument() );
	} );

	it( 'keeps paid models locked and offers configured providers', async () => {
		const connector = connectorFor( { anthropic: true, paid: false } );
		const { trigger, onModelChange } = await renderPicker( 'fast', connector );
		fireEvent.click( trigger );
		const strong = await screen.findByRole( 'option', { name: /^Strong/ } );
		await waitFor( () => expect( strong ).toHaveAttribute( 'aria-disabled', 'true' ) );
		fireEvent.click( strong );
		expect( onModelChange ).not.toHaveBeenCalled();
		fireEvent.click( screen.getByRole( 'option', { name: /Sonnet 5/ } ) );
		await waitFor( () =>
			expect( connector.setSessionProvider ).toHaveBeenCalledWith(
				'test',
				'anthropic-api-key',
				'claude-sonnet-5'
			)
		);
	} );
} );
