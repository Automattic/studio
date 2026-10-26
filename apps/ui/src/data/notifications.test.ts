import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	clearNoticeHistory,
	dismissNotice,
	dismissToast,
	getNoticeHistory,
	getQueuedToastCount,
	getVisibleToasts,
	notifyRendererMounted,
	pauseToastExpiry,
	resetAppMessagesForTests,
	resumeToastExpiry,
	runNoticeAction,
	showToast,
	TOAST_EXIT_MS,
} from './app-messages';

beforeEach( () => {
	vi.useFakeTimers();
	resetAppMessagesForTests();
	notifyRendererMounted();
} );
afterEach( () => {
	resetAppMessagesForTests();
	vi.useRealTimers();
} );

describe( 'notification history and queue', () => {
	it( 'retains reusable actions by default', async () => {
		const onClick = vi.fn();
		const action = { label: 'Open site', onClick };
		showToast( { title: 'Site ready', action } );
		expect( await runNoticeAction( action ) ).toBe( true );
		expect( await runNoticeAction( action ) ).toBe( true );
		expect( onClick ).toHaveBeenCalledTimes( 2 );
		expect( getNoticeHistory()[ 0 ].action ).toBe( action );
	} );

	it( 'runs an expired toast action from history', async () => {
		const onClick = vi.fn();
		const action = { label: 'Undo', onClick, once: true };
		showToast( { title: 'Chat archived', action } );
		vi.advanceTimersByTime( 4500 + TOAST_EXIT_MS );
		expect( getVisibleToasts() ).toHaveLength( 0 );
		expect( await runNoticeAction( action ) ).toBe( true );
		expect( onClick ).toHaveBeenCalledOnce();
		expect( getNoticeHistory()[ 0 ].action ).toBeUndefined();
	} );

	it( 'does not resurface a cleared notification when its pending action finishes', async () => {
		let finish!: () => void;
		const action = {
			label: 'Undo',
			once: true,
			onClick: () => new Promise< void >( ( resolve ) => ( finish = resolve ) ),
		};
		showToast( { title: 'Chat archived', action } );
		const pending = runNoticeAction( action );
		clearNoticeHistory();
		finish();
		await pending;
		vi.runAllTimers();
		expect( getVisibleToasts() ).toHaveLength( 0 );
		expect( getNoticeHistory() ).toHaveLength( 0 );
	} );

	it( 'keeps newest first and bounds history at 50', () => {
		for ( let i = 0; i < 55; i++ ) {
			showToast( { title: String( i ) } );
		}
		expect( getNoticeHistory() ).toHaveLength( 50 );
		expect( getNoticeHistory()[ 0 ].title ).toBe( '54' );
		expect( getVisibleToasts() ).toHaveLength( 3 );
		expect( getQueuedToastCount() ).toBe( 52 );
	} );

	it( 'expires normal and error toasts but retains history', () => {
		showToast( { title: 'Done' } );
		showToast( { title: 'Failed', intent: 'error' } );
		vi.advanceTimersByTime( 4500 + TOAST_EXIT_MS );
		expect( getVisibleToasts().map( ( item ) => item.title ) ).toEqual( [ 'Failed' ] );
		vi.advanceTimersByTime( 5500 );
		expect( getVisibleToasts() ).toHaveLength( 0 );
		expect( getNoticeHistory() ).toHaveLength( 2 );
	} );

	it( 'pauses expiry and gives promoted queued toasts their full lifetime', () => {
		const first = showToast( { title: 'First' } );
		showToast( { title: 'Second' } );
		showToast( { title: 'Third' } );
		showToast( { title: 'Queued' } );
		pauseToastExpiry( first );
		vi.advanceTimersByTime( 4500 + TOAST_EXIT_MS );
		expect( getVisibleToasts().map( ( item ) => item.title ) ).toEqual( [ 'First', 'Queued' ] );
		resumeToastExpiry( first );
		vi.advanceTimersByTime( 4500 + TOAST_EXIT_MS );
		expect( getVisibleToasts() ).toHaveLength( 0 );
	} );

	it( 'dismisses individual visible and queued records, but toast-only dismissal retains history', () => {
		showToast( { title: 'First' } );
		showToast( { title: 'Second' } );
		showToast( { title: 'Third' } );
		showToast( { title: 'Queued' } );
		const record = ( title: string ) =>
			getNoticeHistory().find( ( item ) => item.title === title )!;
		dismissNotice( record( 'Queued' ) );
		expect( getQueuedToastCount() ).toBe( 0 );
		dismissNotice( record( 'First' ) );
		vi.advanceTimersByTime( TOAST_EXIT_MS );
		expect( getVisibleToasts() ).toHaveLength( 2 );
		expect( getNoticeHistory() ).toHaveLength( 2 );
		dismissToast( getVisibleToasts()[ 0 ].id );
		vi.advanceTimersByTime( TOAST_EXIT_MS );
		expect( getNoticeHistory() ).toHaveLength( 2 );
	} );

	it( 'clears history, active toasts and queue without resurfacing entries', () => {
		for ( let i = 0; i < 6; i++ ) {
			showToast( { title: String( i ) } );
		}
		clearNoticeHistory();
		vi.runAllTimers();
		expect( getNoticeHistory() ).toHaveLength( 0 );
		expect( getVisibleToasts() ).toHaveLength( 0 );
		expect( getQueuedToastCount() ).toBe( 0 );
	} );
} );
