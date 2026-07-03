import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	dismissToast,
	getQueuedToastCount,
	getVisibleToasts,
	pauseToastExpiry,
	resetAppMessagesForTests,
	resumeToastExpiry,
	showToast,
	toast,
} from './app-messages';

const titles = () => getVisibleToasts().map( ( item ) => item.title );

describe( 'app-messages', () => {
	beforeEach( () => {
		vi.useFakeTimers();
		resetAppMessagesForTests();
	} );

	afterEach( () => {
		vi.useRealTimers();
	} );

	it( 'shows a toast and expires it after the default duration', () => {
		toast.success( 'Saved' );
		expect( titles() ).toEqual( [ 'Saved' ] );

		vi.advanceTimersByTime( 4_499 );
		expect( titles() ).toEqual( [ 'Saved' ] );

		vi.advanceTimersByTime( 1 );
		expect( titles() ).toEqual( [] );
	} );

	it( 'lets error toasts linger longer than success toasts', () => {
		toast.success( 'Saved' );
		toast.error( 'Failed' );

		vi.advanceTimersByTime( 4_500 );
		expect( titles() ).toEqual( [ 'Failed' ] );

		vi.advanceTimersByTime( 5_500 );
		expect( titles() ).toEqual( [] );
	} );

	it( 'honors a custom duration', () => {
		showToast( { title: 'Quick', durationMs: 1_000 } );

		vi.advanceTimersByTime( 999 );
		expect( titles() ).toEqual( [ 'Quick' ] );

		vi.advanceTimersByTime( 1 );
		expect( titles() ).toEqual( [] );
	} );

	it( 'caps visible toasts at three and promotes the queue on expiry', () => {
		for ( const title of [ 'a', 'b', 'c', 'd', 'e' ] ) {
			toast.info( title );
		}
		expect( titles() ).toEqual( [ 'a', 'b', 'c' ] );

		// All three visible toasts share a start time, so they expire together
		// and both queued toasts are promoted.
		vi.advanceTimersByTime( 4_500 );
		expect( titles() ).toEqual( [ 'd', 'e' ] );
	} );

	it( 'promotes the queue when a visible toast is dismissed', () => {
		for ( const title of [ 'a', 'b', 'c', 'd' ] ) {
			toast.info( title );
		}

		dismissToast( getVisibleToasts()[ 0 ].id );
		expect( titles() ).toEqual( [ 'b', 'c', 'd' ] );
	} );

	it( 'starts a queued toast’s clock at promotion, not enqueue', () => {
		toast.info( 'a' );
		toast.info( 'b' );
		toast.info( 'c' );
		vi.advanceTimersByTime( 4_000 );
		toast.info( 'd' );

		// a/b/c expire 500ms later; d is promoted then and gets its full TTL.
		vi.advanceTimersByTime( 500 );
		expect( titles() ).toEqual( [ 'd' ] );

		vi.advanceTimersByTime( 4_499 );
		expect( titles() ).toEqual( [ 'd' ] );

		vi.advanceTimersByTime( 1 );
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
		expect( titles() ).toEqual( [] );
	} );

	it( 'replaces a queued toast with the same stable id without starting its timer', () => {
		for ( const title of [ 'a', 'b', 'c' ] ) {
			toast.info( title );
		}
		showToast( { id: 'queued', title: 'first' } );
		showToast( { id: 'queued', title: 'second' } );

		vi.advanceTimersByTime( 4_500 );
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
		expect( titles() ).toEqual( [] );
	} );

	it( 'removes a dismissed queued toast without promoting it', () => {
		for ( const title of [ 'a', 'b', 'c' ] ) {
			toast.info( title );
		}
		const queuedId = toast.info( 'queued' );

		dismissToast( queuedId );
		expect( titles() ).toEqual( [ 'a', 'b', 'c' ] );

		vi.advanceTimersByTime( 4_500 );
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
		expect( getQueuedToastCount() ).toBe( 1 );

		vi.advanceTimersByTime( 4_500 );
		expect( getQueuedToastCount() ).toBe( 0 );
	} );
} );
