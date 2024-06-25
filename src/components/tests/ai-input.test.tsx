import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AIInput } from '../ai-input';

const mockShowMessageBox = jest.fn();
jest.mock( '../../lib/get-ipc-api', () => ( {
	getIpcApi: () => ( {
		openURL: jest.fn(),
		generateProposedSitePath: jest.fn(),
		showMessageBox: mockShowMessageBox,
	} ),
} ) );

describe( 'AIInput Component', () => {
	let handleSend: jest.Mock;
	let handleKeyDown: jest.Mock;
	let setInput: jest.Mock;
	let clearInput: jest.Mock;

	const defaultProps = {
		disabled: false,
		input: '',
		setInput: jest.fn(),
		handleSend: jest.fn(),
		handleKeyDown: jest.fn(),
		clearInput: jest.fn(),
		isAssistantThinking: false,
	};

	const getInput = () =>
		screen.getByPlaceholderText( 'What would you like to learn?' ) as HTMLTextAreaElement;

	beforeEach( () => {
		handleSend = jest.fn();
		handleKeyDown = jest.fn();
		setInput = jest.fn();
		clearInput = jest.fn();

		jest.clearAllMocks();

		render(
			<AIInput
				disabled={ defaultProps.disabled }
				input={ defaultProps.input }
				setInput={ setInput }
				handleSend={ handleSend }
				handleKeyDown={ handleKeyDown }
				clearInput={ clearInput }
				isAssistantThinking={ defaultProps.isAssistantThinking }
			/>
		);
	} );

	it( 'renders the component', () => {
		expect( screen.getByTestId( 'ai-input-textarea' ) ).toBeInTheDocument();
	} );

	it( 'focuses on the textarea when not disabled', () => {
		expect( screen.getByTestId( 'ai-input-textarea' ) ).toHaveFocus();
	} );

	it( 'updates input value on change', () => {
		const textarea = getInput();
		fireEvent.change( textarea, { target: { value: 'Updated input' } } );
		expect( setInput ).toHaveBeenCalledWith( 'Updated input' );
	} );

	it( 'does not send message on Shift + Enter key press', () => {
		const textarea = getInput();
		fireEvent.keyDown( textarea, { key: 'Enter', shiftKey: true } );
		expect( handleSend ).not.toHaveBeenCalled();
	} );

	it( 'aligns input to the bottom when content exceeds max height', () => {
		const textarea = getInput();
		const longText = 'Line\n'.repeat( 20 );
		fireEvent.change( textarea, { target: { value: longText } } );
		expect( textarea.scrollTop ).toBe( textarea.scrollHeight - textarea.clientHeight );
	} );

	it( 'handles large multiline input correctly', () => {
		const textarea = getInput();
		const longText = 'Line\n'.repeat( 100 );
		fireEvent.change( textarea, { target: { value: longText } } );
		expect( setInput ).toHaveBeenCalledWith( longText );
		expect( textarea.scrollTop ).toBe( textarea.scrollHeight - textarea.clientHeight );
	} );

	it( 'clears input and chat history when clear conversation button is pressed', async () => {
		const textarea = getInput();
		const longText = 'Line\n'.repeat( 100 );
		fireEvent.change( textarea, { target: { value: longText } } );
		const assistantMenu = screen.getByLabelText( 'Assistant Menu' );
		fireEvent.click( assistantMenu );

		const clearConversationButton = screen.getByTestId( 'clear-conversation-button' );
		mockShowMessageBox.mockResolvedValueOnce( { response: 0 } );
		fireEvent.click( clearConversationButton );

		await waitFor( () => {
			expect( mockShowMessageBox ).toHaveBeenCalled();
			expect( clearInput ).toHaveBeenCalled();
		} );
	} );

	it( 'should clear messages without warning if the warning was previously dismissed', async () => {
		localStorage.setItem( 'dontShowClearMessagesWarning', 'true' );
		const textarea = getInput();
		const longText = 'Line\n'.repeat( 100 );
		fireEvent.change( textarea, { target: { value: longText } } );

		const assistantMenu = screen.getByLabelText( 'Assistant Menu' );
		fireEvent.click( assistantMenu );
		const clearConversationButton = screen.getByTestId( 'clear-conversation-button' );
		mockShowMessageBox.mockResolvedValueOnce( { response: 0, checkboxChecked: true } );
		fireEvent.click( clearConversationButton );

		expect( mockShowMessageBox ).not.toHaveBeenCalled();
		expect( clearInput ).toHaveBeenCalled();
	} );
} );
