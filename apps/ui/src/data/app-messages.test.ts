import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	dismissToast,
	getQueuedToastCount,
	getVisibleToasts,
	notifyRendererMounted,
	pauseToastExpiry,
	resetAppMessagesForTests,
	resumeToastExpiry,
	showToast,
	toast,
	TOAST_EXIT_MS,
} from './app-messages';

const titles = () => getVisibleToasts().map( ( item ) => item.title );
// Expiry/dismissal is two-phase: the toast lingers with `leaving: true` for
// TOAST_EXIT_MS (the exit animation window) before it is removed and the
// queue promotes.
const settleExit = () => vi.advanceTimersByTime( TOAST_EXIT_MS );

describe( 'app-messages', () => {
	beforeEach( () => {
		vi.useFakeTimers();
		resetAppMessagesForTests();
		notifyRendererMounted();
	} );

	afterEach( () => {
		vi.useRealTimers();
	} );

	it( 'shows a toast and expires it after the default duration', () => {
		toast.success( 'Saved' );
		expect( titles() ).toEqual( [ 'Saved' ] );

		vi.advanceTimersByTime( 4_499 );
		expect( titles() ).toEqual( [ 'Saved' ] );

		// Expiry flips it to leaving (still rendered for the exit animation)…
		vi.advanceTimersByTime( 1 );
		expect( titles() ).toEqual( [ 'Saved' ] );
		expect( getVisibleToasts()[ 0 ].leaving ).toBe( true );

		// …and the exit window removes it for real.
		settleExit();
		expect( titles() ).toEqual( [] );
	} );

	it( 'lets error toasts linger longer than success toasts', () => {
		toast.success( 'Saved' );
		toast.error( 'Failed' );

		vi.advanceTimersByTime( 4_500 );
		settleExit();
		expect( titles() ).toEqual( [ 'Failed' ] );

		vi.advanceTimersByTime( 5_300 );
		settleExit();
		expect( titles() ).toEqual( [] );
	} );

	it( 'honors a custom duration', () => {
		showToast( { title: 'Quick', durationMs: 1_000 } );

		vi.advanceTimersByTime( 999 );
		expect( titles() ).toEqual( [ 'Quick' ] );

		vi.advanceTimersByTime( 1 );
		settleExit();
		expect( titles() ).toEqual( [] );
	} );

	it( 'caps visible toasts at three and promotes the queue after the exit window', () => {
		for ( const title of [ 'a', 'b', 'c', 'd', 'e' ] ) {
			toast.info( title );
		}
		expect( titles() ).toEqual( [ 'a', 'b', 'c' ] );

		// All three visible toasts share a start time, so they begin leaving
		// together; promotion waits for their exits to finish.
		vi.advanceTimersByTime( 4_500 );
		expect( titles() ).toEqual( [ 'a', 'b', 'c' ] );
		expect( getVisibleToasts().every( ( item ) => item.leaving ) ).toBe( true );

		settleExit();
		expect( titles() ).toEqual( [ 'd', 'e' ] );
	} );

	it( 'promotes the queue when a visible toast is dismissed', () => {
		for ( const title of [ 'a', 'b', 'c', 'd' ] ) {
			toast.info( title );
		}

		dismissToast( getVisibleToasts()[ 0 ].id );
		// The dismissed toast plays its exit before the queue promotes.
		expect( titles() ).toEqual( [ 'a', 'b', 'c' ] );
		settleExit();
		expect( titles() ).toEqual( [ 'b', 'c', 'd' ] );
	} );

	it( 'starts a queued toast’s clock at promotion, not enqueue', () => {
		toast.info( 'a' );
		toast.info( 'b' );
		toast.info( 'c' );
		vi.advanceTimersByTime( 4_000 );
		toast.info( 'd' );

		// a/b/c expire 500ms later; d is promoted after their exit window and
		// gets its full TTL from that moment.
		vi.advanceTimersByTime( 500 );
		settleExit();
		expect( titles() ).toEqual( [ 'd' ] );

		vi.advanceTimersByTime( 4_499 );
		expect( titles() ).toEqual( [ 'd' ] );

		vi.advanceTimersByTime( 1 );
		settleExit();
		expect( titles() ).toEqual( [] );
	} );

	it( 'replaces a visible toast with the same stable id and restarts its timer', () => {
		showToast( { id: 'copy-feedback', title: 'Copied' } );
		vi.advanceTimersByTime( 4_000 );

		showToast( { id: 'copy-feedback', title: 'Copied again' } );
		expect( titles() ).toEqual( [ 'Copied again' ] );

		vi.advanceTimersByTime( 4_499 );
		expect( titles() ).toEqual( [ 'Copied again' ] );

		vi.advanceTimersByTime( 1 );
		settleExit();
		expect( titles() ).toEqual( [] );
	} );

	it( 'rescues a toast that is re-shown mid-exit', () => {
		const id = showToast( { id: 'rescue', title: 'first' } );
		dismissToast( id );
		expect( getVisibleToasts()[ 0 ].leaving ).toBe( true );

		showToast( { id: 'rescue', title: 'second' } );
		expect( getVisibleToasts()[ 0 ].leaving ).toBeUndefined();

		// Past the original exit window: the rescued toast survives.
		vi.advanceTimersByTime( TOAST_EXIT_MS + 100 );
		expect( titles() ).toEqual( [ 'second' ] );
	} );

	it( 'replaces a queued toast with the same stable id without starting its timer', () => {
		for ( const title of [ 'a', 'b', 'c' ] ) {
			toast.info( title );
		}
		showToast( { id: 'queued', title: 'first' } );
		showToast( { id: 'queued', title: 'second' } );

		vi.advanceTimersByTime( 4_500 );
		settleExit();
		expect( titles() ).toEqual( [ 'second' ] );
	} );

	it( 'pauses and resumes expiry, restarting the full duration', () => {
		const id = toast.info( 'hovered' );

		vi.advanceTimersByTime( 4_000 );
		pauseToastExpiry( id );
		vi.advanceTimersByTime( 60_000 );
		expect( titles() ).toEqual( [ 'hovered' ] );

		resumeToastExpiry( id );
		vi.advanceTimersByTime( 4_499 );
		expect( titles() ).toEqual( [ 'hovered' ] );

		vi.advanceTimersByTime( 1 );
		settleExit();
		expect( titles() ).toEqual( [] );
	} );

	it( 'cannot pause or resume a toast that is already exiting', () => {
		const id = toast.info( 'going' );
		dismissToast( id );

		// Hovering mid-exit must not cancel the removal timer…
		pauseToastExpiry( id );
		// …and un-hovering must not resurrect it with a fresh TTL.
		resumeToastExpiry( id );

		settleExit();
		expect( titles() ).toEqual( [] );
	} );

	it( 'removes a dismissed queued toast immediately, without promoting it', () => {
		for ( const title of [ 'a', 'b', 'c' ] ) {
			toast.info( title );
		}
		const queuedId = toast.info( 'queued' );

		dismissToast( queuedId );
		expect( titles() ).toEqual( [ 'a', 'b', 'c' ] );
		expect( getQueuedToastCount() ).toBe( 0 );

		vi.advanceTimersByTime( 4_500 );
		settleExit();
		expect( titles() ).toEqual( [] );
	} );

	it( 'returns the toast id from showToast', () => {
		const id = showToast( { title: 'hello' } );
		expect( getVisibleToasts()[ 0 ].id ).toBe( id );
	} );

	it( 'tracks the queued count as toasts overflow and promote', () => {
		for ( const title of [ 'a', 'b', 'c', 'd', 'e' ] ) {
			toast.info( title );
		}
		expect( getQueuedToastCount() ).toBe( 2 );

		dismissToast( getVisibleToasts()[ 0 ].id );
		// Promotion waits for the exit window.
		expect( getQueuedToastCount() ).toBe( 2 );
		settleExit();
		expect( getQueuedToastCount() ).toBe( 1 );

		vi.advanceTimersByTime( 4_500 );
		expect( getQueuedToastCount() ).toBe( 0 );
	} );
} );
