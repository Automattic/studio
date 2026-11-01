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
		const attempt = setPendingAuthContext( 'top_bar', 'existing' );

		expect( takePendingAuthContext( attempt.auth_attempt_id ) ).toMatchObject( {
			source: 'top_bar',
			account_type: 'existing',
		} );
	} );

	it( 'returns undefined when auth was never initiated', () => {
		expect( takePendingAuthContext() ).toBeUndefined();
	} );

	// Otherwise a second deep link would silently inherit the first one's attribution.
	it( 'consumes the context so only the first caller gets it', () => {
		const attempt = setPendingAuthContext( 'onboarding', 'new' );

		expect( takePendingAuthContext( attempt.auth_attempt_id ) ).toBeDefined();
		expect( takePendingAuthContext() ).toBeUndefined();
	} );

	it( 'keeps parallel initiations separate', () => {
		const first = setPendingAuthContext( 'onboarding', 'new' );
		const second = setPendingAuthContext( 'settings', 'existing' );

		expect( takePendingAuthContext( second.auth_attempt_id ) ).toMatchObject( {
			source: 'settings',
			account_type: 'existing',
		} );
		expect( takePendingAuthContext( first.auth_attempt_id ) ).toMatchObject( {
			source: 'onboarding',
		} );
	} );

	it( 'discards a context that outlived its TTL', () => {
		vi.useFakeTimers();
		const attempt = setPendingAuthContext( 'sync_tab', 'existing' );

		vi.advanceTimersByTime( 15 * 60 * 1000 + 1 );

		expect( takePendingAuthContext( attempt.auth_attempt_id ) ).toBeUndefined();
	} );

	it( 'still returns a context that is within the TTL', () => {
		vi.useFakeTimers();
		const attempt = setPendingAuthContext( 'sync_tab', 'existing' );

		vi.advanceTimersByTime( 14 * 60 * 1000 );

		expect( takePendingAuthContext( attempt.auth_attempt_id ) ).toMatchObject( {
			source: 'sync_tab',
		} );
	} );
} );
