import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAiCreditsPurchasedListener } from 'src/hooks/use-ai-credits-purchased-listener';
import { useIpcListener } from 'src/hooks/use-ipc-listener';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { useAppDispatch } from 'src/stores';
import { setAiCreditsAdded } from 'src/stores/ui-slice';

vi.mock( 'src/lib/get-ipc-api' );
vi.mock( 'src/hooks/use-ipc-listener' );
vi.mock( 'src/stores', () => ( { useAppDispatch: vi.fn() } ) );

const showUserSettings = vi.fn();

describe( 'useAiCreditsPurchasedListener', () => {
	let eventHandler: () => void = () => undefined;
	let refetchResults: ( number | undefined )[] = [];
	let purchasedRemaining: number | undefined;
	const dispatched: unknown[] = [];

	// The listener reads the quota by dispatching an RTK Query thunk; each
	// dispatched thunk resolves the next server answer.
	const dispatch = vi.fn( ( action: unknown ) => {
		if ( typeof action === 'function' ) {
			if ( refetchResults.length > 0 ) {
				purchasedRemaining = refetchResults.shift();
			}
			const request = Promise.resolve( { data: { purchasedRemaining } } );
			return Object.assign( request, { unsubscribe: vi.fn() } );
		}
		dispatched.push( action );
		return action;
	} );

	beforeEach( () => {
		vi.useFakeTimers();
		vi.clearAllMocks();
		dispatched.length = 0;
		refetchResults = [];
		purchasedRemaining = 0;
		vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( { showUserSettings } );
		vi.mocked( useAppDispatch, { partial: true } ).mockReturnValue( dispatch );
		vi.mocked( useIpcListener, { partial: true } ).mockImplementation( ( _name, handler ) => {
			eventHandler = handler as unknown as typeof eventHandler;
		} );
	} );

	afterEach( () => vi.useRealTimers() );

	it( 'records the added credits once the balance grows', async () => {
		refetchResults = [ 0, 0, 500000 ];
		renderHook( () => useAiCreditsPurchasedListener() );

		act( () => eventHandler() );
		await vi.advanceTimersByTimeAsync( 20000 );

		expect( dispatched ).toContainEqual( setAiCreditsAdded( 500000 ) );
	} );

	it( 'records nothing when the balance never grows', async () => {
		refetchResults = [ 0, 0, 0, 0, 0, 0 ];
		renderHook( () => useAiCreditsPurchasedListener() );

		act( () => eventHandler() );
		await vi.advanceTimersByTimeAsync( 20000 );

		expect( dispatched ).toEqual( [] );
	} );

	it( 'expires the confirmation from when it lands, not from when it is drawn', async () => {
		refetchResults = [ 0, 500000 ];
		renderHook( () => useAiCreditsPurchasedListener() );

		act( () => eventHandler() );
		await vi.advanceTimersByTimeAsync( 0 );
		expect( dispatched ).toEqual( [ setAiCreditsAdded( 500000 ) ] );

		await vi.advanceTimersByTimeAsync( 8000 );
		expect( dispatched ).toEqual( [ setAiCreditsAdded( 500000 ), setAiCreditsAdded( null ) ] );
	} );

	it( 'no longer drags the user into the settings', async () => {
		refetchResults = [ 0, 500000 ];
		renderHook( () => useAiCreditsPurchasedListener() );

		act( () => eventHandler() );
		await vi.advanceTimersByTimeAsync( 20000 );

		expect( showUserSettings ).not.toHaveBeenCalled();
	} );
} );
