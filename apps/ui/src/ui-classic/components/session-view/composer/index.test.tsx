import { DEFAULT_MODEL } from '@studio/common/ai/models';
import { getAiSkillCommands } from '@studio/common/ai/slash-commands';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
	act,
	createEvent,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from '@testing-library/react';
import { Tooltip } from '@wordpress/ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSIONS_QUERY_KEY } from '@/data/queries/use-sessions';
import { Composer } from '.';
import type { ComposerSendAttachments } from './use-composer-attachments';
import type { AiSessionSummary, LoadedAiSession, SessionEntry } from '@/data/core';
import type { ComponentProps } from 'react';

// The AI credits control inside the composer reads the router; the quota it
// also needs stays undefined here, so the control itself renders nothing.
vi.mock( '@tanstack/react-router', () => ( {
	useNavigate: () => vi.fn(),
} ) );

const connectorMocks = vi.hoisted( () => ( {
	capabilities: { aiSettings: false },
	createSession: vi.fn(),
	getAiSettings: vi.fn(),
	getFilePath: vi.fn( ( file: File ) => `/tmp/studio-attachments/${ file.name }` ),
	setSessionModel: vi.fn(),
	setSessionProvider: vi.fn(),
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: () => connectorMocks,
} ) );

const defaultProps = {
	busy: false,
	error: null,
	model: DEFAULT_MODEL,
	onSend: vi.fn< ( prompt: string, attachments?: ComposerSendAttachments ) => Promise< void > >(),
	onInterrupt: vi.fn< () => Promise< void > >(),
	entries: [],
};

function renderComposer(
	props: Partial< ComponentProps< typeof Composer > > = {},
	queryClient = new QueryClient()
) {
	return {
		...render(
			<QueryClientProvider client={ queryClient }>
				<Tooltip.Provider delay={ 0 }>
					<Composer { ...defaultProps } sessionId="session-1" { ...props } />
				</Tooltip.Provider>
			</QueryClientProvider>
		),
		queryClient,
	};
}

function firePointerEventWithClientY( element: Element, type: string, clientY: number ) {
	const event = createEvent( type, element, { bubbles: true } );
	Object.defineProperties( event, {
		button: { value: 0 },
		clientY: { value: clientY },
		pointerId: { value: 1 },
		pointerType: { value: 'mouse' },
	} );
	fireEvent( element, event );
}

describe( 'Composer menu', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		connectorMocks.capabilities.aiSettings = false;
	} );

	it( 'offers the providers above the models the conversation’s provider serves', async () => {
		connectorMocks.capabilities.aiSettings = true;
		connectorMocks.getAiSettings.mockResolvedValue( {
			provider: 'wpcom',
			hasAnthropicApiKey: true,
			anthropicApiKeyPreview: 'sk-ant-api03-tes...1234',
		} );
		renderComposer( {
			entries: [ createSessionContextEntry( 'anthropic-api-key' ) ],
			model: 'claude-sonnet-5',
		} );

		const trigger = screen.getByRole( 'button', { name: 'Select model' } );
		await waitFor( () => expect( trigger ).toHaveTextContent( 'API · Sonnet 5' ) );

		fireEvent.click( trigger );
		await waitFor( () =>
			expect( screen.getAllByRole( 'menuitemradio' ).map( ( item ) => item.textContent ) ).toEqual(
				[ 'WordPress.com', 'Anthropic API', 'Sonnet 5', 'Opus 5' ]
			)
		);
		expect( screen.getByRole( 'menuitemradio', { name: 'Anthropic API' } ) ).toBeChecked();
	} );

	it( 'falls back to WordPress.com when a pinned conversation has no key', async () => {
		connectorMocks.capabilities.aiSettings = true;
		connectorMocks.getAiSettings.mockResolvedValue( {
			provider: 'wpcom',
			hasAnthropicApiKey: false,
			anthropicApiKeyPreview: null,
		} );
		renderComposer( { entries: [ createSessionContextEntry( 'anthropic-api-key' ) ] } );

		const trigger = screen.getByRole( 'button', { name: 'Select model' } );
		await waitFor( () => expect( trigger ).not.toHaveTextContent( 'API ·' ) );

		fireEvent.click( trigger );
		await waitFor( () =>
			expect( screen.getAllByRole( 'menuitemradio' ).map( ( item ) => item.textContent ) ).toEqual(
				[ 'Fast', 'Balanced', 'Strong' ]
			)
		);
	} );

	it( 'omits the provider section until an Anthropic API key is saved', async () => {
		connectorMocks.capabilities.aiSettings = true;
		connectorMocks.getAiSettings.mockResolvedValue( {
			provider: 'wpcom',
			hasAnthropicApiKey: false,
			anthropicApiKeyPreview: null,
		} );
		renderComposer();

		fireEvent.click( screen.getByRole( 'button', { name: 'Select model' } ) );
		await waitFor( () =>
			expect( screen.getAllByRole( 'menuitemradio' ).map( ( item ) => item.textContent ) ).toEqual(
				[ 'Fast', 'Balanced', 'Strong' ]
			)
		);
	} );

	it( 'pins the conversation to the picked provider, carrying a model it serves', async () => {
		const queryClient = new QueryClient();
		connectorMocks.capabilities.aiSettings = true;
		connectorMocks.getAiSettings.mockResolvedValue( {
			provider: 'wpcom',
			hasAnthropicApiKey: true,
			anthropicApiKeyPreview: 'sk-ant-api03-tes...1234',
		} );
		connectorMocks.setSessionProvider.mockResolvedValue( undefined );
		queryClient.setQueryData( [ ...SESSIONS_QUERY_KEY, 'session-1' ], {
			summary: createSummary(),
			entries: [],
		} );
		renderComposer( { model: 'balanced' }, queryClient );

		fireEvent.click( screen.getByRole( 'button', { name: 'Select model' } ) );
		fireEvent.click( await screen.findByRole( 'menuitemradio', { name: 'Anthropic API' } ) );

		await waitFor( () =>
			expect( connectorMocks.setSessionProvider ).toHaveBeenCalledWith(
				'session-1',
				'anthropic-api-key',
				'claude-sonnet-5'
			)
		);
		expect(
			queryClient.getQueryData< LoadedAiSession >( [ ...SESSIONS_QUERY_KEY, 'session-1' ] )?.entries
		).toEqual( [
			expect.objectContaining( {
				customType: 'studio.session_context',
				data: { provider: 'anthropic-api-key', model: 'claude-sonnet-5' },
			} ),
		] );
	} );

	it( 'shows tooltips for the plus button and model picker', async () => {
		renderComposer();

		fireEvent.pointerEnter( screen.getByRole( 'button', { name: 'Add skill or attachment' } ) );
		fireEvent.mouseEnter( screen.getByRole( 'button', { name: 'Add skill or attachment' } ) );
		expect( await screen.findByText( 'Add skill or attachment' ) ).toBeInTheDocument();

		fireEvent.pointerLeave( screen.getByRole( 'button', { name: 'Add skill or attachment' } ) );
		fireEvent.mouseLeave( screen.getByRole( 'button', { name: 'Add skill or attachment' } ) );
		await waitFor( () => {
			expect( screen.queryByText( 'Add skill or attachment' ) ).not.toBeInTheDocument();
		} );

		fireEvent.pointerEnter( screen.getByRole( 'button', { name: 'Select model' } ) );
		fireEvent.mouseEnter( screen.getByRole( 'button', { name: 'Select model' } ) );
		expect( await screen.findByText( 'Select model' ) ).toBeInTheDocument();
	} );

	it( 'shows a tooltip for the stop button while busy', async () => {
		renderComposer( { busy: true } );

		fireEvent.pointerEnter( screen.getByRole( 'button', { name: 'Stop' } ) );
		fireEvent.mouseEnter( screen.getByRole( 'button', { name: 'Stop' } ) );

		expect( await screen.findByText( 'Stop' ) ).toBeInTheDocument();
	} );

	it( 'uses a queue-focused placeholder while busy', () => {
		renderComposer( { busy: true } );

		expect( screen.getByText( 'Queue the next message while I work…' ) ).toBeInTheDocument();
		expect(
			screen.getByPlaceholderText( 'Queue the next message while I work…' )
		).toBeInTheDocument();
	} );

	it( 'keeps the placeholder suggestion steady while the composer sits idle', () => {
		vi.useFakeTimers();
		try {
			renderComposer();

			act( () => {
				vi.advanceTimersByTime( 30000 );
			} );

			expect( screen.getByText( 'What should we make better?' ) ).toBeInTheDocument();
		} finally {
			vi.useRealTimers();
		}
	} );

	it( 'advances the placeholder suggestion after each send', async () => {
		renderComposer();

		fireEvent.change( screen.getByPlaceholderText( 'What should we make better?' ), {
			target: { value: 'ship it' },
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Send' } ) );

		expect( await screen.findByText( 'What’s the next move?' ) ).toBeInTheDocument();
	} );

	it( 'shows a flyout affordance and skill descriptions', async () => {
		renderComposer();

		fireEvent.click( screen.getByRole( 'button', { name: 'Add skill or attachment' } ) );

		const skillsItem = await screen.findByRole( 'menuitem', { name: /Skills/ } );
		expect( within( skillsItem ).getByText( 'Skills' ) ).toBeInTheDocument();
		expect( skillsItem.querySelector( 'svg' ) ).toBeInTheDocument();

		fireEvent.pointerMove( skillsItem );
		fireEvent.mouseEnter( skillsItem );
		fireEvent.keyDown( skillsItem, { key: 'ArrowRight' } );

		await waitFor( () => {
			expect( screen.getByText( getAiSkillCommands()[ 0 ].description ) ).toBeInTheDocument();
		} );
	} );

	it( 'portals attachment hover previews to the document body', async () => {
		const { container } = renderComposer();
		const textFile = new File( [ 'Attachment preview text' ], 'notes.txt', {
			type: 'text/plain',
		} );
		const input = container.querySelector( 'input[type="file"]' ) as HTMLInputElement;

		fireEvent.change( input, {
			target: { files: [ textFile ] },
		} );

		const removeButton = await screen.findByRole( 'button', {
			name: 'Remove attachment: notes.txt',
		} );
		const attachmentItem = removeButton.closest( 'li' );
		expect( attachmentItem ).toBeInTheDocument();
		vi.spyOn( attachmentItem!, 'getBoundingClientRect' ).mockReturnValue( {
			x: 180,
			y: 420,
			top: 420,
			right: 236,
			bottom: 476,
			left: 180,
			width: 56,
			height: 56,
			toJSON: () => ( {} ),
		} );

		fireEvent.pointerEnter( attachmentItem! );

		const preview = await screen.findByRole( 'tooltip' );
		expect( preview ).toHaveTextContent( 'notes.txt' );
		expect( preview.parentElement ).toBe( document.body );
	} );

	it( 'grows, clamps, and shrinks the textarea with draft content', async () => {
		Object.defineProperty( window, 'innerHeight', {
			configurable: true,
			value: 1000,
		} );
		renderComposer();
		const textarea = screen.getByRole( 'combobox' ) as HTMLTextAreaElement;
		let scrollHeight = 72;
		Object.defineProperty( textarea, 'scrollHeight', {
			configurable: true,
			get: () => scrollHeight,
		} );

		fireEvent.change( textarea, {
			target: { value: 'Line one\nLine two\nLine three' },
		} );

		await waitFor( () => {
			expect( textarea ).toHaveStyle( { height: '72px' } );
			expect( textarea ).toHaveStyle( { overflowY: 'hidden' } );
		} );

		scrollHeight = 420;
		fireEvent.change( textarea, {
			target: {
				value: Array.from( { length: 20 }, ( _, index ) => `Line ${ index + 1 }` ).join( '\n' ),
			},
		} );

		await waitFor( () => {
			expect( textarea ).toHaveStyle( { height: '320px' } );
			expect( textarea ).toHaveStyle( { overflowY: 'auto' } );
		} );

		scrollHeight = 36;
		fireEvent.change( textarea, {
			target: { value: 'Short again' },
		} );

		await waitFor( () => {
			expect( textarea ).toHaveStyle( { height: '48px' } );
			expect( textarea ).toHaveStyle( { overflowY: 'hidden' } );
		} );
	} );

	it( 'resizes the textarea when attachments change its padding', async () => {
		const { container } = renderComposer();
		const textarea = screen.getByRole( 'combobox' ) as HTMLTextAreaElement;
		const textFile = new File( [ 'Attachment preview text' ], 'notes.txt', {
			type: 'text/plain',
		} );
		const input = container.querySelector( 'input[type="file"]' ) as HTMLInputElement;
		let scrollHeight = 92;
		Object.defineProperty( textarea, 'scrollHeight', {
			configurable: true,
			get: () => scrollHeight,
		} );

		fireEvent.change( input, {
			target: { files: [ textFile ] },
		} );

		const removeButton = await screen.findByRole( 'button', {
			name: 'Remove attachment: notes.txt',
		} );
		await waitFor( () => {
			expect( textarea ).toHaveStyle( { height: '92px' } );
		} );

		scrollHeight = 36;
		fireEvent.click( removeButton );

		await waitFor( () => {
			expect( textarea ).toHaveStyle( { height: '48px' } );
		} );
	} );

	it( 'resizes the textarea by dragging the composer top edge', async () => {
		Object.defineProperty( window, 'innerHeight', {
			configurable: true,
			value: 1000,
		} );
		renderComposer();
		const textarea = screen.getByRole( 'combobox' ) as HTMLTextAreaElement;
		const resizeHandle = screen.getByRole( 'separator', { name: 'Resize composer' } );
		Object.defineProperty( textarea, 'scrollHeight', {
			configurable: true,
			get: () => 240,
		} );
		vi.spyOn( textarea, 'getBoundingClientRect' ).mockReturnValue( {
			x: 0,
			y: 0,
			top: 0,
			right: 760,
			bottom: 120,
			left: 0,
			width: 760,
			height: 120,
			toJSON: () => ( {} ),
		} );

		firePointerEventWithClientY( resizeHandle, 'pointerdown', 500 );
		firePointerEventWithClientY( resizeHandle, 'pointermove', 420 );

		await waitFor( () => {
			expect( textarea ).toHaveStyle( { height: '200px' } );
			expect( resizeHandle ).toHaveAttribute( 'aria-valuenow', '200' );
		} );

		firePointerEventWithClientY( resizeHandle, 'pointermove', 620 );

		await waitFor( () => {
			expect( textarea ).toHaveStyle( { height: '48px' } );
			expect( resizeHandle ).toHaveAttribute( 'aria-valuenow', '48' );
		} );

		firePointerEventWithClientY( resizeHandle, 'pointerup', 620 );
	} );

	it( 'attaches images pasted outside the textarea and focuses the composer', async () => {
		renderComposer();

		const image = new File( [ 'image-bytes' ], '', { type: 'image/png' } );
		const pasteEvent = new Event( 'paste', { bubbles: true, cancelable: true } );
		Object.defineProperty( pasteEvent, 'clipboardData', {
			value: { files: [ image ], items: [] },
		} );
		fireEvent( document.body, pasteEvent );

		expect( pasteEvent.defaultPrevented ).toBe( true );
		expect(
			await screen.findByRole( 'button', { name: 'Remove attachment: pasted-image.png' } )
		).toBeInTheDocument();
		expect( screen.getByRole( 'combobox' ) ).toHaveFocus();
	} );

	it( 'ignores pastes inside open dialogs', () => {
		renderComposer();

		const dialog = document.createElement( 'div' );
		dialog.setAttribute( 'role', 'dialog' );
		document.body.appendChild( dialog );

		const image = new File( [ 'image-bytes' ], '', { type: 'image/png' } );
		const pasteEvent = new Event( 'paste', { bubbles: true, cancelable: true } );
		Object.defineProperty( pasteEvent, 'clipboardData', {
			value: { files: [ image ], items: [] },
		} );
		fireEvent( dialog, pasteEvent );

		expect( pasteEvent.defaultPrevented ).toBe( false );
		expect( screen.queryByRole( 'button', { name: /Remove attachment/ } ) ).not.toBeInTheDocument();

		dialog.remove();
	} );

	it( 'keeps the picked provider pin in the fresh session cache after a family switch', async () => {
		const queryClient = new QueryClient();
		const onSwitchSession = vi.fn();
		const freshSummary = createSummary( { id: 'fresh-session' } );
		connectorMocks.capabilities.aiSettings = true;
		connectorMocks.getAiSettings.mockResolvedValue( {
			provider: 'wpcom',
			hasAnthropicApiKey: true,
			anthropicApiKeyPreview: 'sk-ant-api03-tes...1234',
		} );
		connectorMocks.createSession.mockResolvedValue( freshSummary );
		connectorMocks.setSessionProvider.mockResolvedValue( undefined );

		renderComposer(
			{
				model: 'balanced',
				entries: [ createUserPromptEntry() ],
				ownerSiteId: 'site-1',
				onSwitchSession,
			},
			queryClient
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Select model' } ) );
		fireEvent.click( await screen.findByRole( 'menuitemradio', { name: 'Anthropic API' } ) );
		const dialog = await screen.findByRole( 'dialog' );
		expect( dialog ).toHaveTextContent( 'Start a new chat?' );
		expect( dialog ).toHaveTextContent(
			'Switching from Balanced to Sonnet 5 starts a fresh chat because the models don\u2019t share memory. You can find previous chats using Chat history below the chat box.'
		);
		expect( within( dialog ).getByText( 'Chat history' ).tagName ).toBe( 'STRONG' );
		expect( dialog ).not.toHaveTextContent( 'sidebar' );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Yes, new chat' } ) );

		await waitFor( () => {
			expect( onSwitchSession ).toHaveBeenCalledWith( 'fresh-session' );
		} );
		expect( connectorMocks.setSessionProvider ).toHaveBeenCalledWith(
			'fresh-session',
			'anthropic-api-key',
			'claude-sonnet-5'
		);

		const loadedSession = queryClient.getQueryData< LoadedAiSession >( [
			...SESSIONS_QUERY_KEY,
			'fresh-session',
		] );
		expect( loadedSession?.summary ).toEqual( freshSummary );
		expect( loadedSession?.entries ).toEqual( [
			expect.objectContaining( {
				customType: 'studio.session_context',
				data: { provider: 'anthropic-api-key', model: 'claude-sonnet-5' },
			} ),
		] );
	} );
} );

function createSummary( overrides: Partial< AiSessionSummary > = {} ): AiSessionSummary {
	return {
		id: 'session-1',
		filePath: '/tmp/session.jsonl',
		createdAt: '2026-06-26T11:00:00.000Z',
		updatedAt: '2026-06-26T11:00:00.000Z',
		ownerSitePath: '/Users/example/Studio/example-site',
		ownerSiteName: 'Example Site',
		activeEnvironment: 'local',
		eventCount: 0,
		...overrides,
	};
}

function createSessionContextEntry( provider: string ): SessionEntry {
	return {
		type: 'custom',
		id: 'session-context-1',
		parentId: null,
		timestamp: '2026-06-26T12:00:00.000Z',
		customType: 'studio.session_context',
		data: { provider, model: 'claude-sonnet-5' },
	} as SessionEntry;
}

function createUserPromptEntry(): SessionEntry {
	return {
		type: 'custom',
		id: 'user-prompt-1',
		parentId: null,
		timestamp: '2026-06-26T12:00:00.000Z',
		customType: 'studio.user_prompt',
		data: { text: 'Make the header calmer' },
	} as SessionEntry;
}
