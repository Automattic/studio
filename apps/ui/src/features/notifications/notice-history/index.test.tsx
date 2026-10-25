import { fireEvent, render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getVisibleToasts, resetAppMessagesForTests, toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { closeNoticeHistory, NoticeHistoryButton, openNoticeHistory } from './index';

vi.mock( '@/data/host/use-color-scheme', () => ( {
	useColorScheme: () => 'light',
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: vi.fn(),
} ) );

function openHistory() {
	fireEvent.click( screen.getByRole( 'button', { name: /^Notification history/ } ) );
}

describe( 'NoticeHistory', () => {
	beforeEach( () => {
		vi.mocked( useConnector ).mockReturnValue( {
			copyText: vi.fn( () => Promise.resolve() ),
		} as never );
	} );

	afterEach( () => {
		closeNoticeHistory();
		resetAppMessagesForTests();
	} );

	it( 'shows an empty state before anything has been shown', () => {
		render( <NoticeHistoryButton /> );
		openHistory();
		expect( screen.getByText( 'No notifications.' ) ).toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Clear all' } ) ).not.toBeInTheDocument();
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

	it( 'lists past notices, and clears them all', () => {
		render( <NoticeHistoryButton /> );
		act( () => {
			toast.error( 'Could not open the terminal.', { description: 'iTerm is not installed.' } );
		} );

		openHistory();
		expect( screen.getByText( 'Could not open the terminal.' ) ).toBeInTheDocument();
		expect( screen.getByText( 'iTerm is not installed.' ) ).toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'Clear all' } ) );
		openHistory();
		expect( screen.getByText( 'No notifications.' ) ).toBeInTheDocument();
	} );

	it( 'keeps the cleared notices on screen while the history closes', () => {
		render( <NoticeHistoryButton /> );
		act( () => {
			toast.success( 'Site started' );
		} );
		openHistory();
		// The popover stays mounted until its exit animation finishes.
		Element.prototype.getAnimations = () => [ { finished: new Promise( () => {} ) } as Animation ];
		try {
			fireEvent.click( screen.getByRole( 'button', { name: 'Clear all' } ) );

			expect( screen.getByText( 'Site started' ) ).toBeInTheDocument();
			expect( screen.queryByText( 'No notifications.' ) ).not.toBeInTheDocument();
		} finally {
			delete ( Element.prototype as Partial< Element > ).getAnimations;
		}
	} );

	it( 'opens from elsewhere once the sidebar has brought the bell into place', async () => {
		const { container } = render( <NoticeHistoryButton /> );
		let arrive = () => {};
		const slide = {
			effect: { target: container },
			finished: new Promise< void >( ( resolve ) => ( arrive = resolve ) ),
		};
		document.getAnimations = () => [ slide as unknown as Animation ];
		try {
			act( () => openNoticeHistory() );
			expect( screen.queryByText( 'No notifications.' ) ).not.toBeInTheDocument();

			await act( async () => arrive() );
			expect( screen.getByText( 'No notifications.' ) ).toBeInTheDocument();
		} finally {
			delete ( document as Partial< Document > ).getAnimations;
		}
	} );

	it( 'dismisses one notice and its toast, keeping the rest', () => {
		render( <NoticeHistoryButton /> );
		act( () => {
			toast.success( 'Site started' );
			toast.success( 'Site stopped' );
		} );
		openHistory();

		fireEvent.click( screen.getByRole( 'button', { name: 'Dismiss Site started' } ) );

		expect( screen.queryByText( 'Site started' ) ).not.toBeInTheDocument();
		expect( screen.getByText( 'Site stopped' ) ).toBeInTheDocument();
		expect( getVisibleToasts().find( ( item ) => item.title === 'Site started' ) ).toMatchObject( {
			leaving: true,
		} );
	} );

	it( 'runs an action again from the history, and closes it', async () => {
		const copyLink = vi.fn();
		render( <NoticeHistoryButton /> );
		act( () => {
			toast.success( 'Preview ready', { action: { label: 'Copy link', onClick: copyLink } } );
		} );

		for ( let run = 1; run <= 2; run++ ) {
			openHistory();
			await act( async () =>
				fireEvent.click( screen.getByRole( 'button', { name: 'Copy link' } ) )
			);
			expect( copyLink ).toHaveBeenCalledTimes( run );
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		}
	} );

	it( 'drops an Undo from the history once it has run', async () => {
		const undo = vi.fn();
		render( <NoticeHistoryButton /> );
		act( () => {
			toast.success( 'Chat archived', { action: { label: 'Undo', once: true, onClick: undo } } );
		} );
		openHistory();

		await act( async () => fireEvent.click( screen.getByRole( 'button', { name: 'Undo' } ) ) );
		openHistory();

		expect( undo ).toHaveBeenCalledTimes( 1 );
		expect( screen.getByText( 'Chat archived' ) ).toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Undo' } ) ).not.toBeInTheDocument();
	} );

	it( 'shows when each notice arrived relative to now', () => {
		vi.useFakeTimers( { now: new Date( '2026-10-22T10:00:00Z' ), toFake: [ 'Date' ] } );
		try {
			act( () => {
				toast.success( 'Site started' );
			} );
			vi.setSystemTime( new Date( '2026-10-22T10:05:00Z' ) );
			render( <NoticeHistoryButton /> );
			openHistory();
			expect( screen.getByText( '5 min. ago' ) ).toBeInTheDocument();
		} finally {
			vi.useRealTimers();
		}
	} );
} );
