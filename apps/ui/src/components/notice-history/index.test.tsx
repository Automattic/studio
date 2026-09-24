import { fireEvent, render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAppMessagesForTests, toast } from '@/data/app-messages';
import { useConnector } from '@/data/core';
import { closeNoticeHistory, NoticeHistoryButton, NoticeHistoryDialog } from './index';

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

		fireEvent.click( screen.getByRole( 'button', { name: 'Notification history' } ) );
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
} );
