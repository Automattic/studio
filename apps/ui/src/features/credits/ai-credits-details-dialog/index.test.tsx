import { fireEvent, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import {
	clearAiCreditsCheckoutPending,
	isAiCreditsCheckoutPending,
} from '@/data/ai-credits-checkout';
import { renderWithProviders } from '@/test/render';
import { AiCreditsDetailsDialog } from './index';

afterEach( clearAiCreditsCheckoutPending );

it( 'records the trip when the user leaves to buy credits', async () => {
	const { connector } = renderWithProviders(
		<AiCreditsDetailsDialog open onOpenChange={ vi.fn() } />
	);
	fireEvent.click( await screen.findByRole( 'link', { name: 'buy more credits' } ) );
	expect( connector.openExternalUrl ).toHaveBeenCalledWith(
		expect.stringContaining( 'studio-code-ai-credits' )
	);
	expect( isAiCreditsCheckoutPending() ).toBe( true );
} );
