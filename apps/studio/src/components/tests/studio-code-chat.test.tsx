import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioCodeChat } from 'src/components/studio-code-chat';
import { useAuth } from 'src/hooks/use-auth';
import { useOffline } from 'src/hooks/use-offline';
import { getIpcApi } from 'src/lib/get-ipc-api';
import type { IpcRendererEvent } from 'electron';
import type { StudioCodeEvent } from 'src/modules/studio-code/studio-code-event-types';

vi.mock( 'src/hooks/use-auth' );
vi.mock( 'src/hooks/use-offline' );
vi.mock( 'src/lib/get-ipc-api' );

// Keep the message renderer trivial so the test asserts conversation flow
// (driven by the real reducer + event parser) rather than markdown output.
vi.mock( 'src/components/studio-code-message', () => ( {
	StudioCodeMessage: ( {
		message,
	}: {
		message: { role: string; content: string; toolCalls: { name: string; status: string }[] };
	} ) => (
		<div data-testid={ `message-${ message.role }` }>
			<span>{ message.content }</span>
			{ message.toolCalls.map( ( tc, i ) => (
				<span key={ i } data-testid="tool-call">
					{ tc.name }:{ tc.status }
				</span>
			) ) }
		</div>
	),
} ) );

// Minimal AIInput so we can drive input + send/clear deterministically.
vi.mock( 'src/components/ai-input', () => ( {
	AIInput: ( {
		input,
		setInput,
		handleSend,
		clearConversation,
		disabled,
	}: {
		input: string;
		setInput: ( v: string ) => void;
		handleSend: () => void;
		clearConversation: () => void;
		disabled: boolean;
	} ) => (
		<div>
			<textarea
				data-testid="ai-input"
				value={ input }
				disabled={ disabled }
				onChange={ ( e ) => setInput( e.target.value ) }
			/>
			<button data-testid="send" onClick={ handleSend }>
				send
			</button>
			<button data-testid="clear" onClick={ clearConversation }>
				clear
			</button>
		</div>
	),
} ) );

const mockStudioCodeSendMessage = vi.fn();
const mockStudioCodeRespondToPermission = vi.fn();
const mockAuthenticate = vi.fn();

const selectedSite = {
	id: 'site-1',
	name: 'One',
	path: '/sites/one',
} as unknown as SiteDetails;

// Capture the renderer-side listener registered via useIpcListener.
let capturedListener:
	| ( ( event: IpcRendererEvent, data: { siteId: string; event: StudioCodeEvent } ) => void )
	| null = null;

function emit( event: StudioCodeEvent, siteId = selectedSite.id ) {
	act( () => {
		capturedListener?.( {} as IpcRendererEvent, { siteId, event } );
	} );
}

beforeEach( () => {
	vi.clearAllMocks();
	localStorage.clear();
	capturedListener = null;
	window.HTMLElement.prototype.scrollIntoView = vi.fn();

	window.ipcListener = {
		subscribe: vi.fn( ( channel: string, listener: unknown ) => {
			if ( channel === 'studio-code-event' ) {
				capturedListener = listener as typeof capturedListener;
			}
			return () => undefined;
		} ),
	} as never;

	vi.mocked( useOffline ).mockReturnValue( false );
	vi.mocked( useAuth, { partial: true } ).mockReturnValue( {
		isAuthenticated: true,
		authenticate: mockAuthenticate,
	} );
	vi.mocked( getIpcApi ).mockReturnValue( {
		studioCodeSendMessage: mockStudioCodeSendMessage,
		studioCodeRespondToPermission: mockStudioCodeRespondToPermission,
		authenticate: mockAuthenticate,
	} as never );
} );

afterEach( () => {
	localStorage.clear();
} );

describe( 'StudioCodeChat', () => {
	it( 'sends a typed message through the IPC bridge and renders it', () => {
		render( <StudioCodeChat selectedSite={ selectedSite } /> );

		fireEvent.change( screen.getByTestId( 'ai-input' ), {
			target: { value: 'build me a plugin' },
		} );
		fireEvent.click( screen.getByTestId( 'send' ) );

		expect( mockStudioCodeSendMessage ).toHaveBeenCalledWith(
			'site-1',
			'/sites/one',
			'One',
			'build me a plugin'
		);
		expect( screen.getByTestId( 'message-user' ) ).toHaveTextContent( 'build me a plugin' );
	} );

	it( 'does not send empty input', () => {
		render( <StudioCodeChat selectedSite={ selectedSite } /> );
		fireEvent.click( screen.getByTestId( 'send' ) );
		expect( mockStudioCodeSendMessage ).not.toHaveBeenCalled();
	} );

	it( 'renders streamed assistant text and tool calls from CLI events', () => {
		render( <StudioCodeChat selectedSite={ selectedSite } /> );

		emit( { type: 'turn.started', timestamp: 't' } );
		emit( {
			type: 'message',
			timestamp: 't',
			message: {
				type: 'message_end',
				message: {
					role: 'assistant',
					content: [
						{ type: 'text', text: 'Working on it' },
						{ type: 'toolCall', id: 'c1', name: 'Read', arguments: {} },
					],
				},
			},
		} as never );

		const assistant = screen.getByTestId( 'message-assistant' );
		expect( assistant ).toHaveTextContent( 'Working on it' );
		expect( screen.getByTestId( 'tool-call' ) ).toHaveTextContent( 'Read:running' );

		emit( {
			type: 'message',
			timestamp: 't',
			message: {
				type: 'turn_end',
				toolResults: [
					{
						role: 'toolResult',
						toolCallId: 'c1',
						content: [ { type: 'text', text: 'ok' } ],
						isError: false,
					},
				],
			},
		} as never );
		expect( screen.getByTestId( 'tool-call' ) ).toHaveTextContent( 'Read:completed' );
	} );

	it( 'shows a permission prompt and answers it over IPC', () => {
		render( <StudioCodeChat selectedSite={ selectedSite } /> );

		// Establish lastUserMessage so the resume carries it.
		fireEvent.change( screen.getByTestId( 'ai-input' ), { target: { value: 'do a thing' } } );
		fireEvent.click( screen.getByTestId( 'send' ) );

		emit( {
			type: 'question.asked',
			timestamp: 't',
			questions: [
				{
					question: 'Allow file write?',
					options: [
						{ label: 'Allow', description: '' },
						{ label: 'Deny', description: '' },
					],
				},
			],
		} );

		expect( screen.getByText( 'Permission Required' ) ).toBeInTheDocument();
		fireEvent.click( screen.getByRole( 'button', { name: 'Allow' } ) );

		expect( mockStudioCodeRespondToPermission ).toHaveBeenCalledWith(
			'site-1',
			'/sites/one',
			'One',
			'do a thing',
			{ 'Allow file write?': 'Allow' }
		);
		// Dialog dismissed after answering.
		expect( screen.queryByText( 'Permission Required' ) ).not.toBeInTheDocument();
	} );

	it( 'clears the conversation', () => {
		render( <StudioCodeChat selectedSite={ selectedSite } /> );
		fireEvent.change( screen.getByTestId( 'ai-input' ), { target: { value: 'hi' } } );
		fireEvent.click( screen.getByTestId( 'send' ) );
		expect( screen.getByTestId( 'message-user' ) ).toBeInTheDocument();

		fireEvent.click( screen.getByTestId( 'clear' ) );
		expect( screen.queryByTestId( 'message-user' ) ).not.toBeInTheDocument();
	} );

	it( 'shows the login gate and disables input when unauthenticated', () => {
		vi.mocked( useAuth, { partial: true } ).mockReturnValue( {
			isAuthenticated: false,
			authenticate: mockAuthenticate,
		} );

		render( <StudioCodeChat selectedSite={ selectedSite } /> );

		expect(
			screen.getByText( 'You need to log in to your WordPress.com account to use Studio Code.' )
		).toBeInTheDocument();
		expect( screen.getByTestId( 'ai-input' ) ).toBeDisabled();
	} );
} );
