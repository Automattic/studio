import { spawnSync } from 'node:child_process';
import { CLI_ACCEPTS_STOP_REQUESTS, CLI_STOP_REQUEST } from '@studio/common/lib/cli-process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emitCliEvent } from 'cli/lib/daemon-client';
import { exitOnCancel, onCancel, reportSyncActivity } from '../sync-activity';

vi.mock( 'cli/lib/daemon-client' );
vi.mock( 'node:child_process', () => ( { spawnSync: vi.fn() } ) );

describe( 'exitOnCancel', () => {
	const originalPlatform = process.platform;
	const originalSend = process.send;
	const events = [ 'SIGTERM', 'message' ];
	const existingListeners = events.flatMap( ( event ) => process.rawListeners( event ) );

	afterEach( () => {
		for ( const event of events ) {
			for ( const listener of process.rawListeners( event ) ) {
				if ( ! existingListeners.includes( listener ) ) {
					process.removeListener( event, listener as () => void );
				}
			}
		}
		Object.defineProperty( process, 'platform', { value: originalPlatform } );
		process.send = originalSend;
		vi.restoreAllMocks();
		vi.mocked( spawnSync ).mockClear();
	} );

	// Hosts send SIGTERM on POSIX, and a stop request over IPC on Windows, where
	// `kill()` can't be caught.
	it.each( [
		[ 'SIGTERM', 'darwin', 'uploading', true ],
		[ 'SIGTERM', 'darwin', 'applyingChanges', false ],
		[ 'a stop request', 'win32', 'uploading', true ],
		[ 'a stop request', 'win32', 'applyingChanges', false ],
	] as const )( 'on %s (%s) while %s, exits: %s', async ( request, platform, phase, exits ) => {
		Object.defineProperty( process, 'platform', { value: platform } );
		const send = vi.fn();
		process.send = send;
		// Vitest's own worker may run over this channel.
		if ( process.channel ) {
			vi.spyOn( process.channel, 'unref' ).mockImplementation( () => undefined );
		}
		vi.mocked( emitCliEvent ).mockResolvedValue();
		const exit = vi.spyOn( process, 'exit' ).mockImplementation( () => undefined as never );
		exitOnCancel();
		await reportSyncActivity( 'site-1', { kind: 'pending', direction: 'push', phase } );

		if ( request === 'SIGTERM' ) {
			process.emit( 'SIGTERM' );
		} else {
			process.emit( 'message', CLI_STOP_REQUEST, undefined );
		}

		expect( send ).toHaveBeenCalledWith( CLI_ACCEPTS_STOP_REQUESTS );
		await vi.waitFor( () => expect( exit ).toHaveBeenCalledTimes( exits ? 1 : 0 ) );
		if ( exits ) {
			expect( emitCliEvent ).toHaveBeenLastCalledWith( {
				event: 'sync-activity',
				data: { siteId: 'site-1', activity: { kind: 'cancelled', direction: 'push' } },
			} );
		}
		// The exit takes php.exe's own subprocesses down too.
		expect( spawnSync ).toHaveBeenCalledTimes( exits && platform === 'win32' ? 1 : 0 );
	} );

	it( 'cleans up what a cancelled step would leave behind before exiting', async () => {
		vi.mocked( emitCliEvent ).mockResolvedValue();
		const exit = vi.spyOn( process, 'exit' ).mockImplementation( () => undefined as never );
		const cleanup = vi.fn().mockResolvedValue( undefined );
		const finished = vi.fn().mockResolvedValue( undefined );
		exitOnCancel();
		onCancel( cleanup );
		onCancel( finished )();
		await reportSyncActivity( 'site-1', {
			kind: 'pending',
			direction: 'push',
			phase: 'creatingBackup',
			provider: 'spacefast',
		} );

		process.emit( 'SIGTERM' );

		await vi.waitFor( () => expect( exit ).toHaveBeenCalledTimes( 1 ) );
		expect( cleanup ).toHaveBeenCalled();
		expect( finished ).not.toHaveBeenCalled();
		expect( emitCliEvent ).toHaveBeenLastCalledWith( {
			event: 'sync-activity',
			data: {
				siteId: 'site-1',
				activity: { kind: 'cancelled', direction: 'push', provider: 'spacefast' },
			},
		} );
	} );
} );
