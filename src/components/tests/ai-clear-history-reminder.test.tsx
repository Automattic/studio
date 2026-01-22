import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';
import AIClearHistoryReminder from 'src/components/ai-clear-history-reminder';
import { CLEAR_HISTORY_REMINDER_TIME } from 'src/constants';
import { getIpcApi } from 'src/lib/get-ipc-api';
import { Message } from 'src/stores/chat-slice';

const mockShowMessageBox = vi.fn();

vi.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: () => ( {
		showMessageBox: mockShowMessageBox,
	} ),
} ) );

describe( 'AIClearHistoryReminder', () => {
	let clearConversation: ReturnType< typeof vi.fn >;
	const MOCKED_CURRENT_TIME = 1718882159928;
	const OLD_MESSAGE_TIME = MOCKED_CURRENT_TIME - CLEAR_HISTORY_REMINDER_TIME - 1;

	beforeEach( () => {
		window.HTMLElement.prototype.scrollIntoView = vi.fn();
		clearConversation = vi.fn();
		mockShowMessageBox.mockClear();
		vi.useFakeTimers();
		vi.setSystemTime( MOCKED_CURRENT_TIME );
	} );

	afterEach( () => {
		vi.useRealTimers();
	} );

	it( 'should display a reminder when the conversation is stale', () => {
		const message: Message = {
			id: 0,
			createdAt: OLD_MESSAGE_TIME,
			content: '',
			role: 'assistant',
		};
		render(
			<AIClearHistoryReminder lastMessage={ message } clearConversation={ clearConversation } />
		);

		expect( screen.getByText( /This conversation is over two hours old./ ) ).toBeVisible();
	} );

	it( 'should warn then clear conversations', async () => {
		mockShowMessageBox.mockResolvedValue( { response: 0, checkboxChecked: false } );
		const message: Message = {
			id: 0,
			createdAt: OLD_MESSAGE_TIME,
			content: '',
			role: 'assistant',
		};
		render(
			<AIClearHistoryReminder lastMessage={ message } clearConversation={ clearConversation } />
		);

		// Use real timers for the async operation
		vi.useRealTimers();
		fireEvent.click( screen.getByText( /Clear the history/ ) );

		await waitFor( () => {
			expect( getIpcApi().showMessageBox ).toHaveBeenCalledTimes( 1 );
			expect( clearConversation ).toHaveBeenCalledTimes( 1 );
		} );
		vi.useFakeTimers();
		vi.setSystemTime( MOCKED_CURRENT_TIME );
	} );

	it( 'should clear conversations without warning if dismised permanently', async () => {
		localStorage.setItem( 'dontShowClearMessagesWarning', 'true' );
		mockShowMessageBox.mockResolvedValue( { response: 1, checkboxChecked: false } );
		const message: Message = {
			id: 0,
			createdAt: OLD_MESSAGE_TIME,
			content: '',
			role: 'assistant',
		};
		render(
			<AIClearHistoryReminder lastMessage={ message } clearConversation={ clearConversation } />
		);

		fireEvent.click( screen.getByText( /Clear the history/ ) );

		expect( getIpcApi().showMessageBox ).not.toHaveBeenCalled();
		expect( clearConversation ).toHaveBeenCalledTimes( 1 );
	} );
} );
