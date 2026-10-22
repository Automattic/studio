import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applySyncActivity, useSiteSyncActivity } from './sync-activity';

describe( 'applySyncActivity', () => {
	afterEach( () => {
		vi.useRealTimers();
	} );

	it( 'shows a sync until its result expires, and settles it only once', () => {
		vi.useFakeTimers();
		const siteId = 'pull-site';
		const { result } = renderHook( () => useSiteSyncActivity( siteId ) );

		act( () => {
			applySyncActivity( siteId, {
				kind: 'pending',
				direction: 'pull',
				message: 'Downloading backup… (50%)',
			} );
		} );
		expect( result.current ).toMatchObject( {
			kind: 'pending',
			message: 'Downloading backup… (50%)',
		} );

		act( () => {
			expect( applySyncActivity( siteId, { kind: 'success', direction: 'pull' } ) ).toBe( true );
			expect( applySyncActivity( siteId, { kind: 'success', direction: 'pull' } ) ).toBe( false );
		} );

		act( () => {
			vi.advanceTimersByTime( 30_000 );
		} );
		expect( result.current ).toBeNull();
	} );

	it( 'describes the phase a push is in, so it never reads as idle', () => {
		const siteId = 'push-site';
		const { result } = renderHook( () => useSiteSyncActivity( siteId ) );

		act( () => {
			applySyncActivity( siteId, {
				kind: 'pending',
				direction: 'push',
				phase: 'creatingRemoteBackup',
				progress: 40,
			} );
		} );
		expect( result.current ).toMatchObject( { message: 'Backing up remote site… (40%)' } );

		// The remote does not report a percentage for every phase.
		act( () => {
			applySyncActivity( siteId, { kind: 'pending', direction: 'push', phase: 'finishing' } );
		} );
		expect( result.current ).toMatchObject( { message: 'Almost there…' } );
	} );
} );
