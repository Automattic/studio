import { fireEvent, render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NoticeHistoryDialog } from '@/components/notice-history';
import { getVisibleToasts, showToast, resetAppMessagesForTests } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { AppToasts } from './index';

vi.mock( '@/hooks/use-color-scheme', () => ( {
	useColorScheme: () => 'light',
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

describe( 'AppToasts', () => {
	beforeEach( () => {
		vi.mocked( useConnector ).mockReturnValue( {
			copyText: vi.fn( () => Promise.resolve() ),
		} as never );
	} );

	afterEach( () => {
		resetAppMessagesForTests();
	} );

	it( 'replaces a toast in place when the same id is shown again', () => {
		render( <AppToasts /> );

		act( () => {
			showToast( { id: 'sync-1', intent: 'info', title: 'Pushing to live', durationMs: 0 } );
		} );
		expect( screen.getByText( 'Pushing to live' ) ).toBeVisible();

		act( () => {
			showToast( { id: 'sync-1', intent: 'success', title: 'Push complete' } );
		} );
		expect( screen.getByText( 'Push complete' ) ).toBeVisible();
		expect( screen.queryByText( 'Pushing to live' ) ).not.toBeInTheDocument();
	} );

	it( 'survives a replacement that drops the description', () => {
		render( <AppToasts /> );

		// A running sync carries phase detail; its result usually doesn't. The
		// shared Notice cannot be reused across that change.
		act( () => {
			showToast( {
				id: 'sync-1',
				intent: 'info',
				title: 'Pushing to live',
				description: 'Uploading… 62%',
				durationMs: 0,
			} );
		} );
		expect( screen.getByText( 'Uploading… 62%' ) ).toBeVisible();

		act( () => {
			showToast( { id: 'sync-1', intent: 'success', title: 'Push complete' } );
		} );

		expect( screen.getByText( 'Push complete' ) ).toBeVisible();
		expect( screen.queryByText( 'Uploading… 62%' ) ).not.toBeInTheDocument();
	} );

	it( 'keeps a pinned toast open with no expiry timer', () => {
		render( <AppToasts /> );

		act( () => {
			showToast( { id: 'sync-1', intent: 'info', title: 'Pulling from live', durationMs: 0 } );
		} );

		expect( screen.getByText( 'Pulling from live' ) ).toBeVisible();
	} );

	it( 'offers Copy and More only on error toasts with details', () => {
		render(
			<>
				<AppToasts />
				<NoticeHistoryDialog />
			</>
		);

		act( () => {
			showToast( { intent: 'success', title: 'Saved', description: 'All good.' } );
			showToast( { intent: 'error', title: 'Failed', description: 'Stack trace…' } );
		} );

		expect( screen.getByRole( 'button', { name: 'Copy' } ) ).toBeVisible();
		fireEvent.click( screen.getByRole( 'button', { name: 'More' } ) );
		expect( screen.getByRole( 'dialog' ) ).toBeVisible();
		expect( screen.getAllByText( 'Stack trace…' ) ).toHaveLength( 2 );
	} );

	it( 'runs a toast’s action once, pending until it settles, then closes the toast', async () => {
		let settle = () => {};
		const undo = vi.fn( () => new Promise< void >( ( resolve ) => ( settle = resolve ) ) );
		render( <AppToasts /> );
		act( () => {
			showToast( { title: 'Chat archived', action: { label: 'Undo', onClick: undo } } );
		} );

		const button = screen.getByRole( 'button', { name: 'Undo' } );
		fireEvent.click( button );
		fireEvent.click( button );
		expect( undo ).toHaveBeenCalledTimes( 1 );
		expect( button ).toBeDisabled();

		await act( async () => settle() );
		expect( getVisibleToasts()[ 0 ] ).toMatchObject( { title: 'Chat archived', leaving: true } );
	} );

	it( 'holds a toast open while it has keyboard focus', () => {
		vi.useFakeTimers();
		try {
			render( <AppToasts /> );
			act( () => {
				showToast( { title: 'Chat archived', action: { label: 'Undo', onClick: vi.fn() } } );
			} );
			const undo = screen.getByRole( 'button', { name: 'Undo' } );

			act( () => undo.focus() );
			act( () => {
				vi.advanceTimersByTime( 10_000 );
			} );
			expect( getVisibleToasts()[ 0 ].leaving ).toBeFalsy();

			act( () => undo.blur() );
			act( () => {
				vi.advanceTimersByTime( 4_500 );
			} );
			expect( getVisibleToasts()[ 0 ].leaving ).toBe( true );
		} finally {
			vi.useRealTimers();
		}
	} );

	it( 'says when a toast’s action fails, and lets it be tried again', async () => {
		const undo = vi.fn().mockRejectedValueOnce( new Error( 'Disk full' ) );
		render( <AppToasts /> );
		act( () => {
			showToast( { title: 'Chat archived', action: { label: 'Undo', onClick: undo } } );
		} );

		await act( async () => fireEvent.click( screen.getByRole( 'button', { name: 'Undo' } ) ) );

		expect( screen.getByText( 'Action failed' ) ).toBeVisible();
		expect( screen.getByText( 'Disk full' ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Undo' } ) ).toBeEnabled();
	} );
} );
