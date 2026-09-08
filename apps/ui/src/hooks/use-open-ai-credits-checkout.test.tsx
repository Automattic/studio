import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	clearAiCreditsCheckoutPending,
	isAiCreditsCheckoutPending,
} from '@/data/ai-credits-checkout';
import { useOpenAiCreditsCheckout } from './use-open-ai-credits-checkout';

const openExternalUrl = vi.fn();

vi.mock( '@/data/core', () => ( { useConnector: () => ( { openExternalUrl } ) } ) );
vi.mock( '@/hooks/use-add-ai-credits-url', () => ( {
	useAddAiCreditsUrlBuilder: () => ( credits?: number ) =>
		`https://checkout.test/${ credits ?? 'default' }`,
} ) );

describe( 'useOpenAiCreditsCheckout', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		clearAiCreditsCheckoutPending();
	} );

	it( 'opens checkout for the chosen amount', () => {
		const { result } = renderHook( () => useOpenAiCreditsCheckout() );

		result.current( 500000 );

		expect( openExternalUrl ).toHaveBeenCalledWith( 'https://checkout.test/500000' );
	} );

	it( 'records the trip so the return has something to check against', () => {
		const { result } = renderHook( () => useOpenAiCreditsCheckout() );
		expect( isAiCreditsCheckoutPending() ).toBe( false );

		result.current();

		expect( isAiCreditsCheckoutPending() ).toBe( true );
	} );
} );
