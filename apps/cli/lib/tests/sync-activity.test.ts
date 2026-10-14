import { afterEach, describe, expect, it, vi } from 'vitest';
import { emitCliEvent } from 'cli/lib/daemon-client';
import { exitOnCancel, reportSyncActivity } from '../sync-activity';

vi.mock( 'cli/lib/daemon-client' );

describe( 'exitOnCancel', () => {
	const existingListeners = process.listeners( 'SIGTERM' );

	afterEach( () => {
		for ( const listener of process.listeners( 'SIGTERM' ) ) {
			if ( ! existingListeners.includes( listener ) ) {
				process.removeListener( 'SIGTERM', listener );
			}
		}
		vi.restoreAllMocks();
	} );

	it.each( [
		[ 'uploading', true ],
		[ 'applyingChanges', false ],
	] as const )( 'on SIGTERM while %s, exits: %s', async ( phase, exits ) => {
		vi.mocked( emitCliEvent ).mockResolvedValue();
		const exit = vi.spyOn( process, 'exit' ).mockImplementation( () => undefined as never );
		exitOnCancel();
		await reportSyncActivity( 'site-1', { kind: 'pending', direction: 'push', phase } );

		process.emit( 'SIGTERM' );

		await vi.waitFor( () => expect( exit ).toHaveBeenCalledTimes( exits ? 1 : 0 ) );
		if ( exits ) {
			expect( emitCliEvent ).toHaveBeenLastCalledWith( {
				event: 'sync-activity',
				data: { siteId: 'site-1', activity: { kind: 'cancelled', direction: 'push' } },
			} );
		}
	} );
} );
