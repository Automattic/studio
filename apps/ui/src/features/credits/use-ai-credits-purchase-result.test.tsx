import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAiCreditsCheckoutPending } from '@/data/ai-credits-checkout';
import { getVisibleToasts } from '@/data/app-messages';
import { useStudioAssistantQuota } from '@/data/queries/use-assistant-quota';
import { createFakeConnector } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';
import { AddAiCreditsButton } from './add-ai-credits-button';
import { useAiCreditsPurchaseResult } from './use-ai-credits-purchase-result';
import type { StudioAssistantQuota } from '@studio/common/lib/studio-assistant-quota';

function Probe() {
	useStudioAssistantQuota();
	useAiCreditsPurchaseResult();
	return <AddAiCreditsButton />;
}

// Each quota fetch answers with the next purchased balance; the last one repeats.
async function setup( balances: ( number | null )[] ) {
	const queue = [ ...balances ];
	const connector = createFakeConnector(
		{},
		{
			getStudioAssistantQuota: async () => {
				const purchasedRemaining = queue.length > 1 ? queue.shift() : queue[ 0 ];
				return purchasedRemaining === null
					? null
					: ( { purchasedRemaining } as StudioAssistantQuota );
			},
		}
	);
	renderWithProviders( <Probe />, { connector } );
	await screen.findByRole( 'button', { name: 'Add AI credits' } );
	await waitFor( () => expect( connector.getStudioAssistantQuota ).toHaveBeenCalledOnce() );
	await act( () => vi.advanceTimersByTimeAsync( 0 ) );
	return connector;
}

// Long enough to run every attempt and its wait.
const runChecks = () => act( () => vi.advanceTimersByTimeAsync( 20_000 ) );

describe( 'AI credits purchase result', () => {
	beforeEach( () => {
		vi.useFakeTimers( { shouldAdvanceTime: true } );
	} );

	afterEach( () => {
		vi.useRealTimers();
		clearAiCreditsCheckoutPending();
	} );

	it( 'confirms a purchase only once the balance grows', async () => {
		const connector = await setup( [ 0, 0, 500000 ] );
		act( () => connector.emit( 'onAiCreditsPurchased' ) );
		await runChecks();
		expect( getVisibleToasts() ).toEqual( [
			expect.objectContaining( { intent: 'success', title: '500,000 AI credits added' } ),
		] );
		expect( connector.getStudioAssistantQuota ).toHaveBeenCalledTimes( 3 );
	} );

	it( 'stays silent when the balance never grows, and ignores a repeated deeplink meanwhile', async () => {
		const connector = await setup( [ 0 ] );
		act( () => {
			connector.emit( 'onAiCreditsPurchased' );
			connector.emit( 'onAiCreditsPurchased' );
		} );
		await runChecks();
		expect( getVisibleToasts() ).toEqual( [] );
		expect( connector.getStudioAssistantQuota ).toHaveBeenCalledTimes( 6 );
	} );

	it( 'stays silent without a baseline to prove an increase against', async () => {
		const connector = await setup( [ null, 500000 ] );
		act( () => connector.emit( 'onAiCreditsPurchased' ) );
		await runChecks();
		expect( getVisibleToasts() ).toEqual( [] );
	} );

	it( 'checks on focus only after leaving for checkout', async () => {
		const connector = await setup( [ 0, 500000 ] );
		fireEvent.focus( window );
		await runChecks();
		expect( connector.getStudioAssistantQuota ).toHaveBeenCalledOnce();

		fireEvent.click( screen.getByRole( 'button', { name: 'Add AI credits' } ) );
		expect( connector.openExternalUrl ).toHaveBeenCalledOnce();
		fireEvent.focus( window );
		await runChecks();
		expect( getVisibleToasts() ).toEqual( [
			expect.objectContaining( { title: '500,000 AI credits added' } ),
		] );
	} );
} );
