import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startDaemonStatusPolling } from 'cli/ai/daemon-status-poll';
import type { AiOutputAdapter } from 'cli/ai/output-adapter';

function makeUi(): AiOutputAdapter {
	return {
		setDaemonStatus: vi.fn(),
	} as unknown as AiOutputAdapter;
}

describe( 'startDaemonStatusPolling', () => {
	beforeEach( () => {
		vi.useFakeTimers();
	} );

	afterEach( () => {
		vi.useRealTimers();
	} );

	it( 'mirrors daemon status on every tick', () => {
		const ui = makeUi();
		const readStatus = vi
			.fn()
			.mockReturnValueOnce( { running: false } )
			.mockReturnValueOnce( { running: true, pid: 111 } )
			.mockReturnValueOnce( { running: false } );

		const stop = startDaemonStatusPolling( ui, {
			intervalMs: 100,
			readStatus,
		} );

		// Initial tick fires synchronously.
		expect( ui.setDaemonStatus ).toHaveBeenNthCalledWith( 1, { running: false } );

		vi.advanceTimersByTime( 100 );
		expect( ui.setDaemonStatus ).toHaveBeenNthCalledWith( 2, { running: true, pid: 111 } );

		vi.advanceTimersByTime( 100 );
		expect( ui.setDaemonStatus ).toHaveBeenNthCalledWith( 3, { running: false } );

		stop();

		vi.advanceTimersByTime( 1000 );
		expect( ui.setDaemonStatus ).toHaveBeenCalledTimes( 3 );
	} );

	it( 'swallows errors thrown by readStatus so the REPL keeps running', () => {
		const ui = makeUi();
		const readStatus = vi
			.fn()
			.mockImplementationOnce( () => {
				throw new Error( 'fs blew up' );
			} )
			.mockReturnValue( { running: false } );

		const stop = startDaemonStatusPolling( ui, {
			intervalMs: 100,
			readStatus,
		} );

		// Initial tick — error is swallowed; the next tick still fires.
		expect( () => vi.advanceTimersByTime( 200 ) ).not.toThrow();
		stop();
	} );
} );
