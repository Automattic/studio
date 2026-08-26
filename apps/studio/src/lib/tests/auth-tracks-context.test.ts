/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, vi } from 'vitest';
import {
	__resetPendingAuthContext,
	setPendingAuthContext,
	takePendingAuthContext,
} from 'src/lib/auth-tracks-context';

describe( 'auth tracks context', () => {
	beforeEach( () => {
		__resetPendingAuthContext();
	} );

	afterEach( () => {
		vi.useRealTimers();
	} );

	it( 'returns the context recorded at initiation', () => {
		setPendingAuthContext( 'top_bar', 'existing' );

		expect( takePendingAuthContext() ).toMatchObject( {
			source: 'top_bar',
			accountType: 'existing',
		} );
	} );

	it( 'returns undefined when auth was never initiated', () => {
		expect( takePendingAuthContext() ).toBeUndefined();
	} );

	// Otherwise a second deep link would silently inherit the first one's attribution.
	it( 'consumes the context so only the first caller gets it', () => {
		setPendingAuthContext( 'onboarding', 'new' );

		expect( takePendingAuthContext() ).toBeDefined();
		expect( takePendingAuthContext() ).toBeUndefined();
	} );

	it( 'keeps only the most recent initiation', () => {
		setPendingAuthContext( 'onboarding', 'new' );
		setPendingAuthContext( 'settings', 'existing' );

		expect( takePendingAuthContext() ).toMatchObject( {
			source: 'settings',
			accountType: 'existing',
		} );
	} );

	it( 'discards a context that outlived its TTL', () => {
		vi.useFakeTimers();
		setPendingAuthContext( 'sync_tab', 'existing' );

		vi.advanceTimersByTime( 15 * 60 * 1000 + 1 );

		expect( takePendingAuthContext() ).toBeUndefined();
	} );

	it( 'still returns a context that is within the TTL', () => {
		vi.useFakeTimers();
		setPendingAuthContext( 'sync_tab', 'existing' );

		vi.advanceTimersByTime( 14 * 60 * 1000 );

		expect( takePendingAuthContext() ).toMatchObject( { source: 'sync_tab' } );
	} );
} );
