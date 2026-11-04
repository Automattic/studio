import { fireEvent, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	toast,
	dismissToast,
	getVisibleToasts,
	showToast,
	resetAppMessagesForTests,
} from '@/data/app-messages';
import { closeNoticeHistory, NoticeHistoryButton } from '@/features/notifications/notice-history';
import { renderWithProviders } from '@/test/render';
import { AppToasts } from './index';
import type { ReactNode } from 'react';

async function render( ui: ReactNode ) {
	renderWithProviders( ui );
	await screen.findByRole( 'region', { name: 'Notifications' } );
}

describe( 'AppToasts', () => {
	afterEach( () => {
		closeNoticeHistory();
		resetAppMessagesForTests();
		vi.useRealTimers();
		vi.restoreAllMocks();
	} );

	it( 'keeps progress visible until replaced by a dismissible result', async () => {
		await render( <AppToasts /> );
		vi.useFakeTimers();
		act( () => {
			toast.processing( 'Creating preview…', { id: 'progress', durationMs: 1 } );
		} );
		expect(
			screen.queryByRole( 'button', { name: 'Dismiss Creating preview…' } )
		).not.toBeInTheDocument();
		act( () => {
			dismissToast( 'progress' );
			vi.advanceTimersByTime( 10_000 );
		} );
		expect( screen.getByText( 'Creating preview…' ) ).toBeVisible();
		const progress = screen.getByRole( 'dialog', { name: 'Creating preview…' } );
		act( () => progress.focus() );
		fireEvent.keyDown( progress, { key: 'Escape' } );
		expect( screen.getByText( 'Creating preview…' ) ).toBeVisible();
		act( () => {
			showToast( { id: 'progress', title: 'Preview ready', intent: 'success' } );
		} );
		expect( screen.getByRole( 'button', { name: 'Dismiss Preview ready' } ) ).toBeVisible();
		expect( screen.queryByText( 'Creating preview…' ) ).not.toBeInTheDocument();
	} );

	it( 'keeps processing notices when clearing history, then allows dismissing the result', async () => {
		await render(
			<>
				<AppToasts />
				<NoticeHistoryButton />
			</>
		);
		act( () => {
			toast.processing( 'Creating preview…', { id: 'progress' } );
			toast.success( 'Site started' );
		} );
		const openHistory = () =>
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Notification history, notifications available' } )
			);
		openHistory();
		expect( await screen.findByText( 'Creating preview…' ) ).toBeVisible();
		expect(
			screen.queryByRole( 'button', { name: 'Dismiss Creating preview…' } )
		).not.toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'button', { name: 'Clear all' } ) );
		await waitFor( () => expect( screen.queryByText( 'Site started' ) ).not.toBeInTheDocument() );
		openHistory();
		expect( await screen.findByText( 'Creating preview…' ) ).toBeVisible();
		act( () => {
			toast.success( 'Preview ready', { id: 'progress' } );
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Dismiss Preview ready' } ) );
		await waitFor( () => expect( screen.queryByText( 'Preview ready' ) ).not.toBeInTheDocument() );
	} );

	it( 'replaces a toast in place, even when the replacement drops the description', async () => {
		await render( <AppToasts /> );

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
		expect( screen.queryByText( 'Pushing to live' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Uploading… 62%' ) ).not.toBeInTheDocument();
	} );

	it( 'keeps Copy available before and after expanding an error', async () => {
		vi.spyOn( HTMLElement.prototype, 'scrollHeight', 'get' ).mockReturnValue( 100 );
		await render( <AppToasts /> );
		act( () => {
			showToast( { intent: 'error', title: 'Failed', description: 'Stack trace…' } );
		} );
		expect( screen.getByRole( 'button', { name: 'Copy' } ) ).toBeVisible();

		fireEvent.click( screen.getByRole( 'button', { name: 'View notification: Failed' } ) );

		expect( screen.getByRole( 'button', { name: 'Copy' } ) ).toBeVisible();
	} );

	it( 'hides the toasts while the history lists them', async () => {
		await render(
			<>
				<AppToasts />
				<NoticeHistoryButton />
			</>
		);
		act( () => {
			showToast( { title: 'Site started' } );
		} );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Notification history, notifications available' } )
		);

		expect( screen.getAllByText( 'Site started' ) ).toHaveLength( 1 );
		expect( screen.getByRole( 'dialog' ) ).toHaveTextContent( 'Site started' );
	} );

	it( 'runs a toast’s action once, pending until it settles, then closes the toast', async () => {
		let settle = () => {};
		const undo = vi.fn( () => new Promise< void >( ( resolve ) => ( settle = resolve ) ) );
		await render( <AppToasts /> );
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

	it( 'holds a toast open while it has keyboard focus', async () => {
		await render( <AppToasts /> );
		vi.useFakeTimers();
		try {
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
		await render( <AppToasts /> );
		act( () => {
			showToast( { title: 'Chat archived', action: { label: 'Undo', onClick: undo } } );
		} );

		await act( async () => fireEvent.click( screen.getByRole( 'button', { name: 'Undo' } ) ) );

		expect( screen.getByText( 'Action failed' ) ).toBeVisible();
		expect( screen.getByText( 'Disk full' ) ).toBeVisible();
		expect( screen.getByRole( 'button', { name: 'Undo' } ) ).toBeEnabled();
	} );
} );
