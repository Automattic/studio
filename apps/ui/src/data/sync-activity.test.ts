import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	reportSyncError,
	reportSyncPending,
	reportSyncSuccess,
	subscribeToSyncActivityEvents,
} from './sync-activity';

describe( 'sync activity events', () => {
	beforeEach( () => vi.useFakeTimers() );
	afterEach( () => vi.useRealTimers() );

	it( 'emits one sound event for each meaningful state transition', () => {
		const listener = vi.fn();
		const unsubscribe = subscribeToSyncActivityEvents( listener );

		reportSyncPending( 'sound-test-site', 'push' );
		reportSyncPending( 'sound-test-site', 'push', { progress: 50 } );
		reportSyncSuccess( 'sound-test-site', 'push' );
		reportSyncSuccess( 'sound-test-site', 'push' );
		reportSyncError( 'sound-test-site', 'push', 'Failed' );
		reportSyncError( 'sound-test-site', 'push', 'Failed again' );

		expect( listener.mock.calls ).toEqual( [
			[ 'sync-started' ],
			[ 'sync-complete' ],
			[ 'sync-failed' ],
		] );
		unsubscribe();
	} );
} );
