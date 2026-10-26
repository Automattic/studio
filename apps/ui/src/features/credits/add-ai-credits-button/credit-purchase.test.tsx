import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AddAiCreditsButton } from '@/features/credits/add-ai-credits-button';
import { createFakeConnector } from '@/test/fake-connector';
import { renderWithProviders } from '@/test/render';

describe( 'credit purchase', () => {
	it( 'lets WordPress.com offer amounts when local pricing is unavailable', async () => {
		const connector = createFakeConnector(
			{},
			{ getStudioAssistantTopUpPricing: async () => null }
		);
		renderWithProviders( <AddAiCreditsButton />, { connector } );
		await waitFor( () => expect( connector.getStudioAssistantTopUpPricing ).toHaveBeenCalled() );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Add AI credits' } ) );
		await waitFor( () => expect( connector.openExternalUrl ).toHaveBeenCalledOnce() );
		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
	} );
} );
