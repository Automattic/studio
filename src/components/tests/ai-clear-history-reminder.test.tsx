import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { CLEAR_HISTORY_REMINDER_TIME } from '../../constants';
import { getIpcApi } from '../../lib/get-ipc-api';
import AIClearHistoryReminder from '../ai-clear-history-reminder';
import type { Message } from '../../hooks/use-assistant';

jest.mock( '../../lib/get-ipc-api' );

describe( 'AIClearHistoryReminder', () => {
	let clearConversation: jest.Mock;
	const MOCKED_CURRENT_TIME = 1718882159928;
	const OLD_MESSAGE_TIME = MOCKED_CURRENT_TIME - CLEAR_HISTORY_REMINDER_TIME - 1;

	beforeEach( () => {
		window.HTMLElement.prototype.scrollIntoView = jest.fn();
		clearConversation = jest.fn();
		jest.clearAllMocks();
		jest.useFakeTimers();
		jest.setSystemTime( MOCKED_CURRENT_TIME );
	} );

	afterEach( () => {
		jest.useRealTimers();
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
		( getIpcApi as jest.Mock ).mockReturnValue( {
			showMessageBox: jest.fn().mockResolvedValue( { response: 0, checkboxChecked: false } ),
		} );
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

		await waitFor( () => {
			expect( getIpcApi().showMessageBox ).toHaveBeenCalledTimes( 1 );
			expect( clearConversation ).toHaveBeenCalledTimes( 1 );
		} );
	} );

	it( 'should clear conversations without warning if dismised permanently', async () => {
		localStorage.setItem( 'dontShowClearMessagesWarning', 'true' );
		( getIpcApi as jest.Mock ).mockReturnValue( {
			showMessageBox: jest.fn().mockResolvedValue( { response: 1, checkboxChecked: false } ),
		} );
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
