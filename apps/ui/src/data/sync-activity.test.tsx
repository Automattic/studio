import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applySyncActivity, getSyncCancelLabels, useSiteSyncActivity } from './sync-activity';

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

describe( 'getSyncCancelLabels', () => {
	it( 'offers the cancel while the work can still be stopped', () => {
		expect(
			getSyncCancelLabels( { kind: 'pending', direction: 'push', phase: 'uploading' } )
		).toEqual( { enabled: true, label: 'Cancel push' } );
		expect(
			getSyncCancelLabels( { kind: 'pending', direction: 'pull', action: 'initiateBackup' } )
		).toEqual( { enabled: true, label: 'Cancel pull' } );
	} );

	// Kept visible but disabled, so the affordance does not vanish mid-sync — the
	// label carries the reason instead.
	it( 'keeps the cancel but explains why it is refused past the point of no return', () => {
		expect(
			getSyncCancelLabels( { kind: 'pending', direction: 'push', phase: 'applyingChanges' } )
		).toEqual( {
			enabled: false,
			label: 'Push can not be cancelled while applying changes to the remote site',
		} );
		expect(
			getSyncCancelLabels( { kind: 'pending', direction: 'pull', action: 'import' } )
		).toEqual( {
			enabled: false,
			label: 'Pull can not be cancelled while importing changes to your local site',
		} );
	} );

	it( 'offers nothing when no push or pull is running', () => {
		expect( getSyncCancelLabels( null ) ).toBeNull();
		expect( getSyncCancelLabels( { kind: 'success', direction: 'pull' } ) ).toBeNull();
		expect( getSyncCancelLabels( { kind: 'pending', direction: 'preview' } ) ).toBeNull();
		// An import rewrites the site but isn't a sync — it must not fall through
		// to the pull wording and offer a cancel this code cannot honour.
		expect( getSyncCancelLabels( { kind: 'pending', direction: 'import' } ) ).toBeNull();
	} );
} );
