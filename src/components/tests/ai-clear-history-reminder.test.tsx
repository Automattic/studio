import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { getIpcApi } from '../../lib/get-ipc-api';
import AIClearHistoryReminder from '../ai-clear-history-reminder';
import type { Message } from '../../hooks/use-assistant';

jest.mock( '../../lib/get-ipc-api' );

describe( 'AIClearHistoryReminder', () => {
	let clearInput: jest.Mock;
	const MOCKED_TIME = 1718882159928;
	const TWO_HOURS_DIFF = 2 * 60 * 60 * 1000;

	beforeEach( () => {
		window.HTMLElement.prototype.scrollIntoView = jest.fn();
		clearInput = jest.fn();
		jest.clearAllMocks();
		jest.useFakeTimers();
		jest.setSystemTime( MOCKED_TIME );
	} );

	afterEach( () => {
		jest.useRealTimers();
	} );

	it( 'should display a reminder when the conversation is stale', () => {
		const message: Message = {
			id: 0,
			createdAt: MOCKED_TIME - TWO_HOURS_DIFF,
			content: '',
			role: 'assistant',
		};
		render( <AIClearHistoryReminder lastMessage={ message } clearInput={ clearInput } /> );

		expect( screen.getByText( /This conversation is over two hours old./ ) ).toBeInTheDocument();
	} );

	it( 'should warn then clear conversations', async () => {
		( getIpcApi as jest.Mock ).mockReturnValue( {
			showMessageBox: jest.fn().mockResolvedValue( { response: 0, checkboxChecked: false } ),
		} );
		const message: Message = {
			id: 0,
			createdAt: MOCKED_TIME - TWO_HOURS_DIFF,
			content: '',
			role: 'assistant',
		};
		render( <AIClearHistoryReminder lastMessage={ message } clearInput={ clearInput } /> );

		fireEvent.click( screen.getByText( /Clear the history/ ) );

		await waitFor( () => {
			expect( getIpcApi().showMessageBox ).toHaveBeenCalledTimes( 1 );
			expect( clearInput ).toHaveBeenCalledTimes( 1 );
		} );
	} );

	it( 'should clear conversations without warning if dismised permanently', async () => {
		localStorage.setItem( 'dontShowClearMessagesWarning', 'true' );
		( getIpcApi as jest.Mock ).mockReturnValue( {
			showMessageBox: jest.fn().mockResolvedValue( { response: 1, checkboxChecked: false } ),
		} );
		const message: Message = {
			id: 0,
			createdAt: MOCKED_TIME - TWO_HOURS_DIFF,
			content: '',
			role: 'assistant',
		};
		render( <AIClearHistoryReminder lastMessage={ message } clearInput={ clearInput } /> );

		fireEvent.click( screen.getByText( /Clear the history/ ) );

		expect( getIpcApi().showMessageBox ).not.toHaveBeenCalled();
		expect( clearInput ).toHaveBeenCalledTimes( 1 );
	} );
} );
