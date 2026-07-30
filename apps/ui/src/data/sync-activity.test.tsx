import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	reportSyncPending,
	reportPullProgress,
	reportSyncSuccess,
	useSiteSyncActivity,
} from './sync-activity';

describe( 'sync activity progress', () => {
	afterEach( () => {
		vi.useRealTimers();
	} );

	it( 'keeps live pull details available across consumers', () => {
		vi.useFakeTimers();
		const siteId = 'background-pull-site';
		const { result } = renderHook( () => useSiteSyncActivity( siteId ) );

		act( () => reportSyncPending( siteId, 'pull' ) );
		expect( result.current ).toEqual( { kind: 'pending', direction: 'pull' } );

		act( () =>
			reportPullProgress( siteId, {
				message: 'Downloading backup… (50%)',
				progress: 50,
			} )
		);
		expect( result.current ).toEqual( {
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
