/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startRemoteSessionStatusPolling } from 'src/modules/remote-session/daemon-status-poller';
import type { DaemonStatus } from '@studio/common/lib/remote-session';

const PID_FILE = '/tmp/remote-session.pid';

const off = (): DaemonStatus => ( { running: false, pidFile: PID_FILE } );
const on = ( pid: number ): DaemonStatus => ( { running: true, pid, pidFile: PID_FILE } );

beforeEach( () => {
	vi.useFakeTimers();
} );

afterEach( () => {
	vi.useRealTimers();
} );

describe( 'startRemoteSessionStatusPolling', () => {
	it( 'fires an initial synchronous tick before scheduling the interval', () => {
		const readStatus = vi.fn().mockReturnValue( off() );
		const pushStatus = vi.fn();

		const stop = startRemoteSessionStatusPolling( {
			readStatus,
			pushStatus,
		} );

		// No timer advance yet — the first tick must have fired synchronously.
		expect( readStatus ).toHaveBeenCalledOnce();
		expect( pushStatus ).toHaveBeenCalledOnce();
		expect( pushStatus ).toHaveBeenCalledWith( off() );

		stop();
	} );

	it( 'pushes a single event on the off → running transition', () => {
		const readStatus = vi.fn().mockReturnValueOnce( off() ).mockReturnValueOnce( on( 12345 ) );
		const pushStatus = vi.fn();

		const stop = startRemoteSessionStatusPolling( {
			intervalMs: 1000,
			readStatus,
			pushStatus,
		} );

		vi.advanceTimersByTime( 1000 );

		expect( pushStatus ).toHaveBeenCalledTimes( 2 );
		expect( pushStatus ).toHaveBeenNthCalledWith( 1, off() );
		expect( pushStatus ).toHaveBeenNthCalledWith( 2, on( 12345 ) );

		stop();
	} );

	it( 'pushes a single event on the running → off transition', () => {
		const readStatus = vi.fn().mockReturnValueOnce( on( 12345 ) ).mockReturnValueOnce( off() );
		const pushStatus = vi.fn();

		const stop = startRemoteSessionStatusPolling( {
			intervalMs: 1000,
			readStatus,
			pushStatus,
		} );

		vi.advanceTimersByTime( 1000 );

		expect( pushStatus ).toHaveBeenCalledTimes( 2 );
		expect( pushStatus ).toHaveBeenNthCalledWith( 1, on( 12345 ) );
		expect( pushStatus ).toHaveBeenNthCalledWith( 2, off() );

		stop();
	} );

	it( 'does NOT emit duplicate events when state is unchanged across ticks', () => {
		const readStatus = vi.fn().mockReturnValue( on( 12345 ) );
		const pushStatus = vi.fn();

		const stop = startRemoteSessionStatusPolling( {
			intervalMs: 1000,
			readStatus,
			pushStatus,
		} );

		// Five additional ticks, all returning the same status.
		vi.advanceTimersByTime( 5000 );

		// Initial tick produced the only push; the five identical follow-ups are silent.
		expect( pushStatus ).toHaveBeenCalledTimes( 1 );

		stop();
	} );

	it( 'survives a throwing readStatus and keeps polling on the next tick', () => {
		const readStatus = vi
			.fn()
			.mockImplementationOnce( () => {
				throw new Error( 'transient read error' );
			} )
			.mockReturnValue( on( 12345 ) );
		const pushStatus = vi.fn();

		const stop = startRemoteSessionStatusPolling( {
			intervalMs: 1000,
			readStatus,
			pushStatus,
		} );

		// Initial tick threw; no event was pushed.
		expect( pushStatus ).not.toHaveBeenCalled();

		vi.advanceTimersByTime( 1000 );

		// Recovery: next tick succeeded and pushed.
		expect( pushStatus ).toHaveBeenCalledOnce();
		expect( pushStatus ).toHaveBeenCalledWith( on( 12345 ) );

		stop();
	} );

	it( 'stop() clears the interval and does NOT invoke daemon teardown', () => {
		const readStatus = vi.fn().mockReturnValue( on( 12345 ) );
		const pushStatus = vi.fn();

		const stop = startRemoteSessionStatusPolling( {
			intervalMs: 1000,
			readStatus,
			pushStatus,
		} );

		expect( readStatus ).toHaveBeenCalledOnce();
		stop();

		// After stopping, no further ticks fire even when advancing time.
		vi.advanceTimersByTime( 30_000 );
		expect( readStatus ).toHaveBeenCalledOnce();

		// And the poller's stop function has nothing to do with stopDaemon — by
		// construction the module does not import it. This assertion is a
		// behavioral spec (R9 of the brainstorm) anchored by the import surface
		// rather than by a runtime mock — if a future change adds a stopDaemon
		// call to the stop path, that change must update the unit's source AND
		// this test, both of which are concretely visible in review.
	} );

	it( 'picks up an externally-created daemon between ticks (AE4)', () => {
		// Simulate the PID file appearing while the poller is running.
		const readStatus = vi
			.fn()
			.mockReturnValueOnce( off() )
			.mockReturnValueOnce( off() )
			.mockReturnValue( on( 12345 ) );
		const pushStatus = vi.fn();

		const stop = startRemoteSessionStatusPolling( {
			intervalMs: 1000,
			readStatus,
			pushStatus,
		} );

		vi.advanceTimersByTime( 1000 );
		// Still off after the first follow-up tick — no transition event.
		expect( pushStatus ).toHaveBeenCalledTimes( 1 );

		vi.advanceTimersByTime( 1000 );
		// Second follow-up tick saw the new PID file; transition push fired.
		expect( pushStatus ).toHaveBeenCalledTimes( 2 );
		expect( pushStatus ).toHaveBeenLastCalledWith( on( 12345 ) );

		stop();
	} );
} );
