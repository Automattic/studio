import { fireEvent, render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getVisibleToasts, resetAppMessagesForTests, toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import {
	closeNoticeHistory,
	NoticeHistoryButton,
	NoticeHistoryDialog,
	openNoticeHistory,
} from './index';

vi.mock( '@/hooks/use-color-scheme', () => ( {
	useColorScheme: () => 'light',
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

const copyText = vi.fn( () => Promise.resolve() );

describe( 'NoticeHistory', () => {
	beforeEach( () => {
		vi.mocked( useConnector ).mockReturnValue( { copyText } as never );
	} );

	afterEach( () => {
		closeNoticeHistory();
		resetAppMessagesForTests();
		copyText.mockClear();
	} );

	it( 'shows an empty state before anything has been shown', () => {
		render(
			<>
				<NoticeHistoryButton />
				<NoticeHistoryDialog />
			</>
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Notification history' } ) );
		expect( screen.getByText( 'No notifications yet' ) ).toBeVisible();
		expect( screen.queryByRole( 'button', { name: 'Clear all' } ) ).not.toBeInTheDocument();
	} );

	it( 'lists past notices in full, copies one, and clears them all', async () => {
		render(
			<>
				<NoticeHistoryButton />
				<NoticeHistoryDialog />
			</>
		);
		act( () => {
			toast.error( 'Could not open the terminal.', { description: 'iTerm is not installed.' } );
		} );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Notification history, notifications available' } )
		);
		expect( screen.getByText( 'Could not open the terminal.' ) ).toBeVisible();
		expect( screen.getByText( 'iTerm is not installed.' ) ).toBeVisible();

		fireEvent.click( screen.getByRole( 'button', { name: 'Copy' } ) );
		expect( copyText ).toHaveBeenCalledWith(
			'Could not open the terminal.\niTerm is not installed.'
		);
		expect( await screen.findByRole( 'button', { name: 'Copied' } ) ).toBeVisible();

		fireEvent.click( screen.getByRole( 'button', { name: 'Clear all' } ) );
		expect( screen.getByText( 'No notifications yet' ) ).toBeVisible();
	} );

	it( 'marks the bell while there are notifications', () => {
		render( <NoticeHistoryButton /> );
		expect( screen.getByRole( 'button', { name: 'Notification history' } ) ).toBeVisible();

		act( () => {
			toast.success( 'Site started' );
		} );
		expect(
			screen.getByRole( 'button', { name: 'Notification history, notifications available' } )
		).toBeVisible();
	} );

	it( 'dismisses one notice and its toast, keeping the rest', () => {
		render( <NoticeHistoryDialog /> );
		act( () => {
			toast.success( 'Site started' );
			toast.success( 'Site stopped' );
			openNoticeHistory();
		} );

		fireEvent.click( screen.getByRole( 'button', { name: 'Dismiss Site started' } ) );

		expect( screen.queryByText( 'Site started' ) ).not.toBeInTheDocument();
		expect( screen.getByText( 'Site stopped' ) ).toBeVisible();
		expect( getVisibleToasts().find( ( item ) => item.title === 'Site started' ) ).toMatchObject( {
			leaving: true,
		} );
	} );

	it( 'runs an action again from the history, and closes it', async () => {
		const copyLink = vi.fn();
		render( <NoticeHistoryDialog /> );
		act( () => {
			toast.success( 'Preview ready', { action: { label: 'Copy link', onClick: copyLink } } );
		} );

		for ( let run = 1; run <= 2; run++ ) {
			act( () => openNoticeHistory() );
			await act( async () =>
				fireEvent.click( screen.getByRole( 'button', { name: 'Copy link' } ) )
			);
			expect( copyLink ).toHaveBeenCalledTimes( run );
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		}
	} );

	it( 'drops an Undo from the history once it has run', async () => {
		const undo = vi.fn();
		render( <NoticeHistoryDialog /> );
		act( () => {
			toast.success( 'Chat archived', { action: { label: 'Undo', once: true, onClick: undo } } );
			openNoticeHistory();
		} );

		await act( async () => fireEvent.click( screen.getByRole( 'button', { name: 'Undo' } ) ) );
		act( () => openNoticeHistory() );

		expect( undo ).toHaveBeenCalledTimes( 1 );
		expect( screen.getByText( 'Chat archived' ) ).toBeVisible();
		expect( screen.queryByRole( 'button', { name: 'Undo' } ) ).not.toBeInTheDocument();
	} );

	it( 'shows when each notice arrived relative to now', () => {
		vi.useFakeTimers( { now: new Date( '2026-10-22T10:00:00Z' ), toFake: [ 'Date' ] } );
		try {
			act( () => {
				toast.success( 'Site started' );
			} );
			vi.setSystemTime( new Date( '2026-10-22T10:05:00Z' ) );
			render( <NoticeHistoryDialog /> );
			act( () => openNoticeHistory() );
			expect( screen.getByText( '5 min. ago' ) ).toBeVisible();
		} finally {
			vi.useRealTimers();
		}
	} );
} );
