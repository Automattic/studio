import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	clearAiCreditsCheckoutPending,
	isAiCreditsCheckoutPending,
} from '@/data/ai-credits-checkout';
import { useConnector } from '@/data/core';
import { useAppGlobals } from '@/data/queries/use-app-globals';
import { AiCreditsDetailsDialog } from './index';

vi.mock( '@/data/core', () => ( { useConnector: vi.fn() } ) );
vi.mock( '@/data/queries/use-app-globals', () => ( { useAppGlobals: vi.fn() } ) );

describe( 'AiCreditsDetailsDialog', () => {
	const openExternalUrl = vi.fn();

	beforeEach( () => {
		vi.clearAllMocks();
		clearAiCreditsCheckoutPending();
		vi.mocked( useConnector ).mockReturnValue( { openExternalUrl } as never );
		// A browser tab, where the return is a window focus rather than a
		// deeplink — so the trip has to be recorded for it to be noticed.
		vi.mocked( useAppGlobals ).mockReturnValue( { data: { platform: 'browser' } } as never );
	} );

	it( 'records the trip when the user leaves to buy credits', () => {
		render( <AiCreditsDetailsDialog open onOpenChange={ vi.fn() } /> );

		fireEvent.click( screen.getByRole( 'link', { name: 'buy more credits' } ) );

		expect( openExternalUrl ).toHaveBeenCalledWith(
			expect.stringContaining( 'studio-code-ai-credits' )
		);
		expect( isAiCreditsCheckoutPending() ).toBe( true );
	} );
} );
