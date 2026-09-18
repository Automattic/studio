import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	clearAiCreditsCheckoutPending,
	markAiCreditsCheckoutPending,
} from '@/data/ai-credits-checkout';
import { getVisibleToasts, resetAppMessagesForTests } from '@/data/app-messages';
import { useAiCreditsPurchaseResult } from './use-ai-credits-purchase-result';

const navigate = vi.fn();
let onPurchased: () => void = () => undefined;
const connector = {
	onAiCreditsPurchased: ( listener: () => void ) => {
		onPurchased = listener;
		return () => undefined;
	},
};

// The cache the hook reads; each refetch shifts in the next server answer.
let purchasedRemaining: number | undefined;
let refetchResults: ( number | undefined )[] = [];
const refetchQueries = vi.fn( async () => {
	if ( refetchResults.length > 0 ) {
		purchasedRemaining = refetchResults.shift();
	}
} );

vi.mock( '@tanstack/react-query', () => ( {
	useQueryClient: () => ( {
		getQueryData: () => ( { purchasedRemaining } ),
		refetchQueries,
	} ),
} ) );
vi.mock( '@tanstack/react-router', () => ( { useNavigate: () => navigate } ) );
vi.mock( '@/data/core', () => ( { useConnector: () => connector } ) );
vi.mock( '@/data/queries/use-auth-user', () => ( { useAuthUser: () => ( { data: { id: 7 } } ) } ) );
vi.mock( '@/data/queries/use-user-locale', () => ( { useUserLocale: () => 'en' } ) );

async function flushPoll() {
	// Long enough to run every attempt and its wait.
	await vi.advanceTimersByTimeAsync( 20000 );
}

describe( 'useAiCreditsPurchaseResult', () => {
	beforeEach( () => {
		vi.useFakeTimers();
		vi.clearAllMocks();
		resetAppMessagesForTests();
		clearAiCreditsCheckoutPending();
		purchasedRemaining = 0;
		refetchResults = [];
	} );

	afterEach( () => vi.useRealTimers() );

	it( 'confirms a purchase only once the balance grows', async () => {
		refetchResults = [ 0, 500000 ];
		renderHook( () => useAiCreditsPurchaseResult() );

		onPurchased();
		await flushPoll();

		expect( getVisibleToasts() ).toEqual( [
			expect.objectContaining( {
				id: 'ai-credits-purchased',
				intent: 'success',
				title: '500,000 AI credits added',
			} ),
		] );
	} );

	it( 'stays silent when the balance never grows', async () => {
		refetchResults = [ 0, 0, 0, 0, 0 ];
		renderHook( () => useAiCreditsPurchaseResult() );

		onPurchased();
		await flushPoll();

		expect( getVisibleToasts() ).toEqual( [] );
		expect( refetchQueries ).toHaveBeenCalledTimes( 5 );
	} );

	it( 'stays silent without a baseline to prove an increase against', async () => {
		purchasedRemaining = undefined;
		refetchResults = [ 500000 ];
		renderHook( () => useAiCreditsPurchaseResult() );

		onPurchased();
		await flushPoll();

		expect( getVisibleToasts() ).toEqual( [] );
	} );

	it( 'ignores a repeated deeplink while a check is already running', async () => {
		refetchResults = [ 0, 0, 0, 0, 0 ];
		renderHook( () => useAiCreditsPurchaseResult() );

		onPurchased();
		onPurchased();
		await flushPoll();

		expect( refetchQueries ).toHaveBeenCalledTimes( 5 );
	} );

	it( 'checks on focus only while a checkout is pending', async () => {
		renderHook( () => useAiCreditsPurchaseResult() );

		window.dispatchEvent( new Event( 'focus' ) );
		await flushPoll();
		expect( refetchQueries ).not.toHaveBeenCalled();

		markAiCreditsCheckoutPending();
		refetchResults = [ 500000 ];
		window.dispatchEvent( new Event( 'focus' ) );
		await flushPoll();

		expect( getVisibleToasts() ).toEqual( [
			expect.objectContaining( { title: '500,000 AI credits added' } ),
		] );
	} );
} );
