import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Composer } from '@/features/composer';
import { createFakeConnector } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import type { StudioAssistantQuota } from '@studio/common/lib/studio-assistant-quota';

const quota: StudioAssistantQuota = {
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

async function setup( getQuota: () => Promise< StudioAssistantQuota | null > ) {
	const connector = createFakeConnector( {}, {
		getStudioAssistantQuota: getQuota,
		getStudioAssistantTopUpPricing: async () => ( {
			options: [ { credits: 100000, display: '$10' } ],
		} ),
	} as never );
	renderWithProviders(
		<Composer
			busy={ false }
			model="fast"
			sessionId="test"
			entries={ [] }
			onSend={ vi.fn() }
			onInterrupt={ vi.fn() }
		/>,
		{ connector }
	);
	const trigger = await screen.findByRole( 'button', { name: 'Model' } );
	await waitFor( () => expect( connector.getStudioAssistantQuota ).toHaveBeenCalled() );
	return { connector, trigger };
}

describe( 'Chat model control', () => {
	it( 'shows legacy allowance without offering credit purchases', async () => {
		const { trigger } = await setup( async () => ( {
			...quota,
			allowanceRemaining: undefined,
			purchasedRemaining: undefined,
		} ) );
		await waitFor( () =>
			expect( trigger ).toHaveAttribute(
				'aria-description',
				'Fast · WordPress.com · AI allowance: 60% remaining'
			)
		);
		fireEvent.click( trigger );
		await screen.findByRole( 'option', { name: /^Fast/ } );
		expect( screen.queryByRole( 'option', { name: /^Get more credits/ } ) ).not.toBeInTheDocument();
	} );

	it( 'hides stale balance and purchase action on query failure', async () => {
		const { trigger } = await setup( async () => {
			throw new Error( 'Usage unavailable' );
		} );
		await waitFor( () =>
			expect( trigger ).toHaveAttribute(
				'aria-description',
				'Fast · WordPress.com · AI usage unavailable'
			)
		);
		fireEvent.click( trigger );
		await screen.findByRole( 'option', { name: /^Fast/ } );
		expect( screen.queryByRole( 'option', { name: /^Get more credits/ } ) ).not.toBeInTheDocument();
	} );

	it( 'opens the existing purchase dialog from the model picker and continues to desktop checkout', async () => {
		const { connector, trigger } = await setup( async () => quota );
		fireEvent.click( trigger );
		const buy = await screen.findByRole( 'option', { name: /^Get more credits/ } );
		await waitFor( () => expect( buy ).not.toHaveAttribute( 'aria-disabled', 'true' ) );
		fireEvent.click( buy );
		expect( await screen.findByRole( 'heading', { name: 'Add AI credits' } ) ).toBeVisible();
		expect( screen.queryByRole( 'option', { name: /^Fast/ } ) ).not.toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'button', { name: /^Continue/ } ) );
		await waitFor( () =>
			expect( connector.openExternalUrl ).toHaveBeenCalledWith(
				expect.stringContaining( 'studioReturnTo=ai-credits-purchased' )
			)
		);
	} );
} );
