import { vi, describe, it, expect, beforeEach } from 'vitest';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { store } from 'src/stores';
import {
	loadOnboardingStatus,
	saveOnboardingStatus,
	setOnboardingCompleted,
	selectOnboardingCompleted,
	selectOnboardingLoading,
} from 'src/stores/onboarding-slice';
import {
	resetDispatchedActions,
	testActions,
	testReducer,
} from 'src/stores/tests/utils/test-reducer';

vi.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: vi.fn(),
} ) );

const mockIpcApi = {
	getOnboardingData: vi.fn(),
	saveOnboarding: vi.fn(),
};

vi.mocked( getIpcApi, { partial: true } ).mockReturnValue( mockIpcApi );

store.replaceReducer( testReducer );

describe( 'onboarding-slice', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		store.dispatch( testActions.resetState() );
		resetDispatchedActions();
	} );

	describe( 'initial state', () => {
		it( 'should have correct initial state', () => {
			const state = store.getState();
			expect( selectOnboardingCompleted( state ) ).toBe( false );
			expect( selectOnboardingLoading( state ) ).toBe( true );
		} );
	} );

	describe( 'setOnboardingCompleted', () => {
		it( 'should update completed state when set to true', () => {
			store.dispatch( setOnboardingCompleted( true ) );
			const state = store.getState();
			expect( selectOnboardingCompleted( state ) ).toBe( true );
		} );

		it( 'should update completed state when set to false', () => {
			// First set to true
			store.dispatch( setOnboardingCompleted( true ) );
			// Then set to false
			store.dispatch( setOnboardingCompleted( false ) );
			const state = store.getState();
			expect( selectOnboardingCompleted( state ) ).toBe( false );
		} );
	} );

	describe( 'loadOnboardingStatus', () => {
		it( 'should set loading to true when pending', async () => {
			mockIpcApi.getOnboardingData.mockResolvedValueOnce( true );

			const promise = store.dispatch( loadOnboardingStatus() );

			// Check loading state while pending
			const pendingState = store.getState();
			expect( selectOnboardingLoading( pendingState ) ).toBe( true );

			await promise;
		} );

		it( 'should update completed state and set loading to false when fulfilled', async () => {
			mockIpcApi.getOnboardingData.mockResolvedValueOnce( true );

			const result = await store.dispatch( loadOnboardingStatus() );

			expect( result.type ).toBe( 'onboarding/loadStatus/fulfilled' );
			expect( result.payload ).toBe( true );

			const state = store.getState();
			expect( selectOnboardingCompleted( state ) ).toBe( true );
			expect( selectOnboardingLoading( state ) ).toBe( false );
		} );

		it( 'should handle false response from getOnboardingData', async () => {
			mockIpcApi.getOnboardingData.mockResolvedValueOnce( false );

			const result = await store.dispatch( loadOnboardingStatus() );

			expect( result.type ).toBe( 'onboarding/loadStatus/fulfilled' );
			expect( result.payload ).toBe( false );

			const state = store.getState();
			expect( selectOnboardingCompleted( state ) ).toBe( false );
			expect( selectOnboardingLoading( state ) ).toBe( false );
		} );

		it( 'should set loading to false when rejected', async () => {
			mockIpcApi.getOnboardingData.mockRejectedValue( new Error( 'Test error' ) );

			const promise = store.dispatch( loadOnboardingStatus() );

			// Check loading state while pending
			const pendingState = store.getState();
			expect( selectOnboardingLoading( pendingState ) ).toBe( true );

			const result = await promise;
			expect( result.type ).toBe( 'onboarding/loadStatus/rejected' );

			const state = store.getState();
			expect( selectOnboardingLoading( state ) ).toBe( false );
		} );
	} );

	describe( 'saveOnboardingStatus', () => {
		it( 'should update completed state when fulfilled with true', async () => {
			mockIpcApi.saveOnboarding.mockResolvedValue( undefined );

			const result = await store.dispatch( saveOnboardingStatus( true ) );

			expect( result.type ).toBe( 'onboarding/saveStatus/fulfilled' );
			expect( result.payload ).toBe( true );

			const state = store.getState();
			expect( selectOnboardingCompleted( state ) ).toBe( true );
		} );

		it( 'should update completed state when fulfilled with false', async () => {
			mockIpcApi.saveOnboarding.mockResolvedValue( undefined );

			const result = await store.dispatch( saveOnboardingStatus( false ) );

			expect( result.type ).toBe( 'onboarding/saveStatus/fulfilled' );
			expect( result.payload ).toBe( false );

			const state = store.getState();
			expect( selectOnboardingCompleted( state ) ).toBe( false );
		} );

		it( 'should call saveOnboarding with correct parameter', async () => {
			mockIpcApi.saveOnboarding.mockResolvedValue( undefined );

			await store.dispatch( saveOnboardingStatus( true ) );

			expect( mockIpcApi.saveOnboarding ).toHaveBeenCalledWith( true );
		} );

		it( 'should handle rejection from saveOnboarding', async () => {
			mockIpcApi.saveOnboarding.mockRejectedValue( new Error( 'Save failed' ) );

			const result = await store.dispatch( saveOnboardingStatus( true ) );

			expect( result.type ).toBe( 'onboarding/saveStatus/rejected' );
		} );
	} );

	describe( 'selectors', () => {
		it( 'should select onboarding completed state correctly', () => {
			// Initial state should be false
			let state = store.getState();
			expect( selectOnboardingCompleted( state ) ).toBe( false );

			// After setting to true
			store.dispatch( setOnboardingCompleted( true ) );
			state = store.getState();
			expect( selectOnboardingCompleted( state ) ).toBe( true );

			// After setting to false
			store.dispatch( setOnboardingCompleted( false ) );
			state = store.getState();
			expect( selectOnboardingCompleted( state ) ).toBe( false );
		} );

		it( 'should select onboarding loading state correctly', () => {
			// Initial state should be true
			let state = store.getState();
			expect( selectOnboardingLoading( state ) ).toBe( true );

			// Mock the API to trigger loading state
			mockIpcApi.getOnboardingData.mockResolvedValue( true );

			// Dispatch and check loading state
			const promise = store.dispatch( loadOnboardingStatus() );
			state = store.getState();
			expect( selectOnboardingLoading( state ) ).toBe( true );

			// Wait for completion and check final state
			return promise.then( () => {
				state = store.getState();
				expect( selectOnboardingLoading( state ) ).toBe( false );
			} );
		} );
	} );

	describe( 'integration scenarios', () => {
		it( 'should handle complete onboarding flow', async () => {
			// Start with loading onboarding status
			mockIpcApi.getOnboardingData.mockResolvedValue( false );
			mockIpcApi.saveOnboarding.mockResolvedValue( undefined );

			// Load initial status
			await store.dispatch( loadOnboardingStatus() );
			let state = store.getState();
			expect( selectOnboardingCompleted( state ) ).toBe( false );
			expect( selectOnboardingLoading( state ) ).toBe( false );

			// Complete onboarding
			await store.dispatch( saveOnboardingStatus( true ) );
			state = store.getState();
			expect( selectOnboardingCompleted( state ) ).toBe( true );
		} );

		it( 'should maintain state consistency across multiple operations', async () => {
			mockIpcApi.getOnboardingData.mockResolvedValue( true );
			mockIpcApi.saveOnboarding.mockResolvedValue( undefined );

			// Load status
			await store.dispatch( loadOnboardingStatus() );
			let state = store.getState();
			expect( selectOnboardingCompleted( state ) ).toBe( true );

			// Update via action
			store.dispatch( setOnboardingCompleted( false ) );
			state = store.getState();
			expect( selectOnboardingCompleted( state ) ).toBe( false );

			// Save new status
			await store.dispatch( saveOnboardingStatus( false ) );
			state = store.getState();
			expect( selectOnboardingCompleted( state ) ).toBe( false );
		} );
	} );
} );
