import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	reportSyncPending,
	reportSyncProgress,
	reportSyncSuccess,
	useSiteSyncActivity,
} from './sync-activity';

describe( 'sync activity pull progress', () => {
	afterEach( () => {
		vi.useRealTimers();
	} );

	it( 'keeps live pull details available across consumers', () => {
		vi.useFakeTimers();
		const siteId = 'background-pull-site';
		const { result } = renderHook( () => useSiteSyncActivity( siteId ) );

		act( () => reportSyncPending( siteId, 'pull' ) );
		expect( result.current ).toMatchObject( { kind: 'pending', direction: 'pull' } );

		act( () =>
			reportSyncProgress( siteId, 'pull', {
				message: 'Downloading backup… (50%)',
				progress: 50,
			} )
		);
		expect( result.current ).toMatchObject( {
			kind: 'pending',
			direction: 'pull',
			message: 'Downloading backup… (50%)',
			progress: 50,
		} );

		act( () => {
			reportSyncSuccess( siteId, 'pull' );
			vi.advanceTimersByTime( 30_000 );
		} );
		expect( result.current ).toBeNull();
	} );
} );
