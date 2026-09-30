import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emitCliEvent } from 'cli/lib/daemon-client';
import { exitOnCancel, reportSyncActivity } from '../sync-activity';

vi.mock( 'cli/lib/daemon-client' );

describe( 'exitOnCancel', () => {
	const existingListeners = process.listeners( 'SIGTERM' );

	beforeEach( () => {
		vi.mocked( emitCliEvent ).mockResolvedValue();
	} );

	afterEach( () => {
		for ( const listener of process.listeners( 'SIGTERM' ) ) {
			if ( ! existingListeners.includes( listener ) ) {
				process.removeListener( 'SIGTERM', listener );
			}
		}
		vi.restoreAllMocks();
	} );

	it( 'reports the cancel and exits while the sync can still be stopped', async () => {
		const exit = vi.spyOn( process, 'exit' ).mockImplementation( () => undefined as never );
		exitOnCancel();
		await reportSyncActivity( 'site-1', {
			kind: 'pending',
			direction: 'push',
			phase: 'uploading',
		} );

		process.emit( 'SIGTERM' );

		await vi.waitFor( () => expect( exit ).toHaveBeenCalled() );
		expect( emitCliEvent ).toHaveBeenLastCalledWith( {
			event: 'sync-activity',
			data: { siteId: 'site-1', activity: { kind: 'cancelled', direction: 'push' } },
		} );
	} );

	it( 'keeps going once the live site is being changed', async () => {
		const exit = vi.spyOn( process, 'exit' ).mockImplementation( () => undefined as never );
		exitOnCancel();
		await reportSyncActivity( 'site-1', {
			kind: 'pending',
			direction: 'push',
			phase: 'applyingChanges',
		} );

		process.emit( 'SIGTERM' );

		expect( exit ).not.toHaveBeenCalled();
	} );
} );
