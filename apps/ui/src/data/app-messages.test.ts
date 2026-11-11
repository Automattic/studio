import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	dismissToast,
	getQueuedToastCount,
	getVisibleToasts,
	notifyRendererMounted,
	notifyRendererUnmounted,
	pauseToastExpiry,
	resetAppMessagesForTests,
	resumeToastExpiry,
	runNoticeAction,
	showToast,
	toast,
	TOAST_EXIT_MS,
} from './app-messages';

const titles = () => getVisibleToasts().map( ( item ) => item.title );
const settleExit = () => vi.advanceTimersByTime( TOAST_EXIT_MS );

describe( 'app-messages', () => {
	beforeEach( () => {
		vi.useFakeTimers();
		resetAppMessagesForTests();
		notifyRendererMounted();
	} );
	afterEach( () => {
		resetAppMessagesForTests();
		vi.useRealTimers();
	} );

	it( 'expires confirmations after their full visible duration', () => {
		toast.success( 'Saved' );
		vi.advanceTimersByTime( 4499 );
		expect( getVisibleToasts()[ 0 ].leaving ).toBeUndefined();
		vi.advanceTimersByTime( 1 );
		expect( getVisibleToasts()[ 0 ].leaving ).toBe( true );
		settleExit();
		expect( titles() ).toEqual( [] );
	} );

	it.each( [ 'error', 'warning' ] as const )( 'keeps %s until manually dismissed', ( intent ) => {
		const id = toast[ intent ]( 'Needs attention' );
		vi.advanceTimersByTime( 120_000 );
		pauseToastExpiry( id );
		resumeToastExpiry( id );
		vi.advanceTimersByTime( 120_000 );
		expect( getVisibleToasts()[ 0 ].leaving ).toBeUndefined();
		dismissToast( id );
		settleExit();
		expect( titles() ).toEqual( [] );
	} );

	it( 'never evicts persistent notices and admits new failures immediately', () => {
		for ( let i = 0; i < 3; i++ ) toast.processing( `Export ${ i }` );
		toast.error( 'Disk full' );
		toast.warning( 'Only some changes applied' );
		vi.advanceTimersByTime( 60_000 );
		expect( titles() ).toEqual( [
			'Export 0',
			'Export 1',
			'Export 2',
			'Disk full',
			'Only some changes applied',
		] );
		expect( getVisibleToasts().some( ( item ) => item.leaving ) ).toBe( false );
	} );

	it( 'suppresses dismissed progress updates but shows the result and the next attempt', () => {
		toast.processing( 'Importing', { id: 'import' } );
		dismissToast( 'import' );
		toast.processing( 'Importing 50%', { id: 'import' } );
		settleExit();
		expect( titles() ).toEqual( [] );
		toast.error( 'Import failed', { id: 'import' } );
		expect( titles() ).toEqual( [ 'Import failed' ] );
		toast.processing( 'Importing again', { id: 'import' } );
		expect( titles() ).toEqual( [ 'Importing again' ] );
		toast.success( 'Import complete', { id: 'import' } );
		vi.advanceTimersByTime( 4500 );
		settleExit();
		expect( titles() ).toEqual( [] );
	} );

	it( 'queues confirmations and starts their timer only after promotion', () => {
		for ( let i = 0; i < 3; i++ ) toast.info( `Notice ${ i }` );
		vi.advanceTimersByTime( 4000 );
		toast.info( 'Last' );
		expect( getQueuedToastCount() ).toBe( 1 );
		vi.advanceTimersByTime( 500 );
		settleExit();
		expect( titles() ).toEqual( [ 'Last' ] );
		vi.advanceTimersByTime( 4499 );
		expect( getVisibleToasts()[ 0 ].leaving ).toBeUndefined();
		vi.advanceTimersByTime( 1 );
		settleExit();
		expect( titles() ).toEqual( [] );
	} );

	it( 'promotes a queued confirmation immediately if replaced by a failure', () => {
		for ( let i = 0; i < 3; i++ ) toast.info( `Notice ${ i }` );
		toast.info( 'Checking', { id: 'check' } );
		toast.error( 'Check failed', { id: 'check' } );
		expect( titles() ).toContain( 'Check failed' );
		expect( getQueuedToastCount() ).toBe( 0 );
	} );

	it( 'replaces repeated failures instead of adding duplicates and rescues mid-exit replacements', () => {
		toast.error( 'Failed', { id: 'operation' } );
		dismissToast( 'operation' );
		toast.error( 'Failed again', { id: 'operation' } );
		settleExit();
		expect( titles() ).toEqual( [ 'Failed again' ] );
	} );

	it( 'pauses confirmations for hover/focus and never resurrects an exiting notice', () => {
		const id = toast.success( 'Saved' );
		pauseToastExpiry( id );
		vi.advanceTimersByTime( 60_000 );
		expect( titles() ).toEqual( [ 'Saved' ] );
		resumeToastExpiry( id );
		vi.advanceTimersByTime( 4500 );
		pauseToastExpiry( id );
		resumeToastExpiry( id );
		settleExit();
		expect( titles() ).toEqual( [] );
	} );

	it( 'starts confirmation timers only while the renderer is mounted', () => {
		notifyRendererUnmounted();
		toast.info( 'Saved' );
		vi.advanceTimersByTime( 60_000 );
		expect( titles() ).toEqual( [ 'Saved' ] );
		notifyRendererMounted();
		vi.advanceTimersByTime( 4500 );
		settleExit();
		expect( titles() ).toEqual( [] );
	} );

	it( 'leaves errors visible when an inspection action succeeds', async () => {
		const action = { label: 'Open logs', onClick: vi.fn(), dismissOnSuccess: false };
		toast.error( 'Import failed', { action } );
		expect( await runNoticeAction( action ) ).toBe( true );
		expect( getVisibleToasts()[ 0 ].leaving ).toBeUndefined();
	} );

	it( 'runs recovery once while pending and dismisses only after success', async () => {
		let finish!: () => void;
		const action = {
			label: 'Undo',
			onClick: vi.fn(
				() =>
					new Promise< void >( ( resolve ) => {
						finish = resolve;
					} )
			),
		};
		showToast( { title: 'Archived', action, durationMs: 10_000 } );
		const pending = runNoticeAction( action );
		expect( await runNoticeAction( action ) ).toBe( false );
		vi.advanceTimersByTime( 60_000 );
		expect( getVisibleToasts()[ 0 ].leaving ).toBeUndefined();
		finish();
		await pending;
		expect( getVisibleToasts()[ 0 ].leaving ).toBe( true );
		expect( await runNoticeAction( action ) ).toBe( false );
	} );

	it( 'does not dismiss a replacement created by a retry action', async () => {
		const action = {
			label: 'Retry',
			onClick: () => {
				toast.processing( 'Retrying', { id: 'operation' } );
			},
		};
		toast.error( 'Failed', { id: 'operation', action } );
		await runNoticeAction( action );
		expect( titles() ).toEqual( [ 'Retrying' ] );
		expect( getVisibleToasts()[ 0 ].leaving ).toBeUndefined();
	} );

	it( 'keeps a failed action retryable without stacking a second failure', async () => {
		const action = {
			label: 'Retry',
			onClick: vi
				.fn()
				.mockRejectedValueOnce( new Error( 'Offline' ) )
				.mockResolvedValue( undefined ),
		};
		toast.error( 'Failed', { action } );
		expect( await runNoticeAction( action ) ).toBe( false );
		expect( getVisibleToasts() ).toHaveLength( 1 );
		expect( getVisibleToasts()[ 0 ] ).toMatchObject( {
			description: 'Offline',
			actionPending: false,
			durationMs: 0,
		} );
		expect( await runNoticeAction( action ) ).toBe( true );
	} );

	it( 'keeps a processing action pending across progress updates and waits for the result', async () => {
		let finish!: () => void;
		const onClick = vi.fn( () => new Promise< void >( ( resolve ) => ( finish = resolve ) ) );
		const action = { label: 'Cancel', onClick };
		toast.processing( 'Pulling changes…', { id: 'pull', action } );
		const pending = runNoticeAction( action );
		toast.processing( 'Pulling changes…', { id: 'pull', action, description: 'Downloading…' } );
		expect( getVisibleToasts()[ 0 ].actionPending ).toBe( true );
		expect( await runNoticeAction( action ) ).toBe( false );
		expect( onClick ).toHaveBeenCalledOnce();
		finish();
		await pending;
		settleExit();
		expect( titles() ).toEqual( [ 'Pulling changes…' ] );
		expect( getVisibleToasts()[ 0 ].leaving ).toBeUndefined();
		toast.info( 'Pull cancelled', { id: 'pull' } );
		expect( titles() ).toEqual( [ 'Pull cancelled' ] );
	} );

	it( 'keeps a replacement result visible when its action finishes', async () => {
		const action = {
			label: 'Cancel',
			onClick: () => {
				toast.info( 'Pull cancelled', { id: 'pull' } );
			},
		};
		toast.processing( 'Pulling changes…', { id: 'pull', action } );
		await runNoticeAction( action );
		settleExit();
		expect( titles() ).toEqual( [ 'Pull cancelled' ] );
		expect( getVisibleToasts()[ 0 ].leaving ).toBeUndefined();
	} );

	it( 'cannot run an action after its toast expires', async () => {
		const action = { label: 'Undo', onClick: vi.fn() };
		toast.success( 'Archived', { action, durationMs: 10_000 } );
		vi.advanceTimersByTime( 10_000 );
		settleExit();
		expect( await runNoticeAction( action ) ).toBe( false );
		expect( action.onClick ).not.toHaveBeenCalled();
	} );
} );

it( 'preserves the original failure when opening its logs fails', async () => {
	resetAppMessagesForTests();
	const action = {
		label: 'Open logs',
		dismissOnSuccess: false,
		onClick: vi.fn().mockRejectedValue( new Error( 'Logs unavailable' ) ),
	};
	toast.error( 'Import failed', { description: 'The backup is incomplete.', action } );
	await runNoticeAction( action );
	expect( getVisibleToasts() ).toHaveLength( 1 );
	expect( getVisibleToasts()[ 0 ] ).toMatchObject( {
		title: 'Import failed',
		description: 'The backup is incomplete.\nLogs unavailable',
		durationMs: 0,
	} );
	resetAppMessagesForTests();
} );
