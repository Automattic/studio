import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAuthAttempt, createAuthAttemptStore, getAuthTracksProps } from '../auth-tracks';
import { getAuthenticationUrl, getSignUpUrl } from '../oauth';

afterEach( () => vi.useRealTimers() );

describe( 'auth attempt attribution', () => {
	it( 'matches parallel returns by state, consumes once, and never guesses', () => {
		const store = createAuthAttemptStore();
		const first = createAuthAttempt( 'onboarding', true );
		const second = createAuthAttempt( 'settings', false );
		store.add( first );
		store.add( second );
		expect( store.take() ).toBeUndefined();
		expect( store.take( first.auth_attempt_id ) ).toEqual( first );
		expect( store.take( first.auth_attempt_id ) ).toBeUndefined();
		expect( store.take( second.auth_attempt_id ) ).toEqual( second );
	} );

	it( 'discards expired and restarted context', () => {
		vi.useFakeTimers();
		const store = createAuthAttemptStore();
		const attempt = createAuthAttempt( 'settings', false );
		store.add( attempt );
		vi.advanceTimersByTime( 15 * 60 * 1000 + 1 );
		expect( store.take( attempt.auth_attempt_id ) ).toBeUndefined();
		store.add( attempt );
		store.clear();
		expect( store.take( attempt.auth_attempt_id ) ).toBeUndefined();
	} );

	it( 'keeps only bounded metadata and opaque IDs', () => {
		const attempt = createAuthAttempt( 'settings', true, {
			placement: 'settings_ai',
			intent: 'build',
			journey_id: crypto.randomUUID(),
			...{ email: 'private@example.com', token: 'secret' },
		} );
		expect( getAuthTracksProps( attempt ) ).toMatchObject( {
			placement: 'settings_ai',
			intent: 'build',
			auth_flow: 'signup',
			account_type: 'new',
		} );
		expect( JSON.stringify( getAuthTracksProps( attempt ) ) ).not.toMatch( /private|secret/ );
		expect( getAuthTracksProps() ).toEqual( { source: 'unknown' } );
	} );

	it( 'carries the opaque state through both authorization URLs', () => {
		const state = crypto.randomUUID();
		expect(
			new URL( getAuthenticationUrl( 'en', undefined, state ) ).searchParams.get( 'state' )
		).toBe( state );
		const signup = new URL( getSignUpUrl( 'en', undefined, state ) );
		expect(
			new URL( signup.searchParams.get( 'oauth2_redirect' )! ).searchParams.get( 'state' )
		).toBe( state );
	} );
} );
