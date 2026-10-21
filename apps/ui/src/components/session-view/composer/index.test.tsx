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
import { createRef, type ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSIONS_QUERY_KEY } from '@/data/queries/use-sessions';
import { clearComposerDrafts } from './draft-store';
import { Composer, type ComposerHandle } from '.';
import type { ComposerSendAttachments } from './use-composer-attachments';
import type { AiSessionSummary, LoadedAiSession, SessionEntry } from '@/data/core';

// "Connect provider…" opens the settings dialog through the router.
vi.mock( '@tanstack/react-router', () => ( {
	useNavigate: () => vi.fn(),
} ) );

const connectorMocks = vi.hoisted( () => ( {
	createSession: vi.fn(),
	getAiSettings: vi.fn(),
	getAuthUser: vi.fn(),
	getStudioAssistantQuota: vi.fn(),
	getUserPreferences: vi.fn(),
	setUserPreferences: vi.fn(),
	getFilePath: vi.fn( ( file: File ) => `/tmp/studio-attachments/${ file.name }` ),
	setSessionModel: vi.fn(),
	setSessionProvider: vi.fn(),
} ) );

vi.mock( '@/data/core', () => ( {
	useConnector: () => connectorMocks,
} ) );

const defaultProps = {
	busy: false,
	model: DEFAULT_MODEL,
	onSend: vi.fn< ( prompt: string, attachments?: ComposerSendAttachments ) => Promise< void > >(),
	onInterrupt: vi.fn< () => Promise< void > >(),
	entries: [],
};

function renderComposer(
	props: Partial< ComponentProps< typeof Composer > > = {},
	queryClient = new QueryClient()
) {
	const composerRef = createRef< ComposerHandle >();
	const renderTree = ( nextProps: Partial< ComponentProps< typeof Composer > > = {} ) => (
		<QueryClientProvider client={ queryClient }>
			<Tooltip.Provider delay={ 0 }>
				<Composer ref={ composerRef } { ...defaultProps } sessionId="session-1" { ...nextProps } />
			</Tooltip.Provider>
		</QueryClientProvider>
	);
	const rendered = render( renderTree( props ) );
	return {
		...rendered,
		composerRef,
		queryClient,
		rerenderComposer: ( nextProps: Partial< ComponentProps< typeof Composer > > = {} ) =>
			rendered.rerender( renderTree( nextProps ) ),
	};
}

describe( 'Composer menu', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		clearComposerDrafts();
		connectorMocks.getAiSettings.mockResolvedValue( {
			provider: 'wpcom',
			hasAnthropicApiKey: false,
			anthropicApiKeyPreview: null,
		} );
		connectorMocks.getUserPreferences.mockResolvedValue( { autoStartSiteOnChat: false } );
		connectorMocks.setUserPreferences.mockResolvedValue( undefined );
	} );

	it( 'offers the providers above the models the conversation’s provider serves', async () => {
		connectorMocks.getAiSettings.mockResolvedValue( {
			provider: 'wpcom',
			hasAnthropicApiKey: true,
			anthropicApiKeyPreview: 'sk-ant-api03-tes...1234',
		} );
		renderComposer( {
			entries: [ createSessionContextEntry( 'anthropic-api-key' ) ],
			model: 'claude-sonnet-5',
		} );

		const trigger = screen.getByRole( 'button', { name: 'Model' } );
		await waitFor( () =>
			expect( trigger ).toHaveAccessibleDescription( 'Sonnet 5 · Anthropic API' )
		);

		fireEvent.click( trigger );
		await waitFor( () =>
			expect( getMenuLabels() ).toEqual(
				startingWith( [ 'WordPress.com', 'Anthropic API', 'Sonnet 5', 'Opus 5' ] )
			)
		);
		expect( screen.getByRole( 'menuitemradio', { name: 'Anthropic API' } ) ).toBeChecked();
	} );

	it( 'falls back to WordPress.com when a pinned conversation has no key', async () => {
		connectorMocks.getAiSettings.mockResolvedValue( {
			provider: 'wpcom',
			hasAnthropicApiKey: false,
			anthropicApiKeyPreview: null,
		} );
		renderComposer( { entries: [ createSessionContextEntry( 'anthropic-api-key' ) ] } );

		const trigger = screen.getByRole( 'button', { name: 'Model' } );
		await waitFor( () => expect( trigger ).toHaveAccessibleDescription( 'Fast · WordPress.com' ) );

		fireEvent.click( trigger );
		await waitFor( () =>
			expect( getMenuLabels() ).toEqual( startingWith( [ 'Fast', 'Balanced', 'Strong' ] ) )
		);
	} );

	it( 'omits the provider section until an Anthropic API key is saved', async () => {
		connectorMocks.getAiSettings.mockResolvedValue( {
			provider: 'wpcom',
			hasAnthropicApiKey: false,
			anthropicApiKeyPreview: null,
		} );
		renderComposer();

		fireEvent.click( screen.getByRole( 'button', { name: 'Model' } ) );
		await waitFor( () =>
			expect( getMenuLabels() ).toEqual( startingWith( [ 'Fast', 'Balanced', 'Strong' ] ) )
		);
	} );

	it( 'pins the conversation to the picked provider, carrying a model it serves', async () => {
		const queryClient = new QueryClient();
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

		fireEvent.click( screen.getByRole( 'button', { name: 'Model' } ) );
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

	it( 'acts as a form field: no send control, the draft read back through the ref', async () => {
		const onModelChange = vi.fn();
		const { composerRef, container } = renderComposer( {
			variant: 'field',
			model: 'balanced',
			sessionId: undefined,
			placeholder: 'Describe the site',
			onModelChange,
		} );

		expect( screen.queryByRole( 'button', { name: 'Send message' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Add' } ) ).not.toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Upload attachment' } ) ).toBeInTheDocument();
		expect( composerRef.current?.getSubmission() ).toBeNull();

		const textarea = screen.getByPlaceholderText( 'Describe the site' );
		fireEvent.change( textarea, { target: { value: 'A bright ceramics portfolio' } } );
		fireEvent.keyDown( textarea, { key: 'Enter' } );
		expect( defaultProps.onSend ).not.toHaveBeenCalled();

		const image = new File( [ 'image-bytes' ], 'moodboard.png', { type: 'image/png' } );
		fireEvent.change( container.querySelector( 'input[type="file"]' ) as HTMLInputElement, {
			target: { files: [ image ] },
		} );
		await screen.findByRole( 'listitem', { name: /^moodboard\.png/ } );
		expect( composerRef.current?.getSubmission() ).toMatchObject( {
			prompt: 'A bright ceramics portfolio',
			attachments: { images: [ expect.objectContaining( { name: 'moodboard.png' } ) ], files: [] },
		} );

		fireEvent.click( screen.getByRole( 'button', { name: 'Model' } ) );
		fireEvent.click( await screen.findByRole( 'menuitemradio', { name: /^Fast/ } ) );
		expect( onModelChange ).toHaveBeenCalledWith( 'fast' );
		expect( connectorMocks.setSessionModel ).not.toHaveBeenCalled();
	} );

	it( 'disables the paid tiers unless purchased credits remain', async () => {
		connectorMocks.getAuthUser.mockResolvedValue( { id: 1, email: 'user@example.com' } );
		connectorMocks.getStudioAssistantQuota.mockResolvedValue( { purchasedRemaining: 0 } );
		const { unmount } = renderComposer();

		fireEvent.click( screen.getByRole( 'button', { name: 'Model' } ) );
		await waitFor( () => {
			expect( screen.getByRole( 'menuitemradio', { name: /^Balanced/ } ) ).toHaveAttribute(
				'aria-disabled',
				'true'
			);
		} );
		expect( screen.getByRole( 'menuitemradio', { name: /^Strong/ } ) ).toHaveAttribute(
			'aria-disabled',
			'true'
		);
		expect( screen.getByRole( 'menuitemradio', { name: /^Fast/ } ) ).not.toHaveAttribute(
			'aria-disabled'
		);
		unmount();

		connectorMocks.getStudioAssistantQuota.mockResolvedValue( { purchasedRemaining: 50_000 } );
		renderComposer();

		fireEvent.click( screen.getByRole( 'button', { name: 'Model' } ) );
		await waitFor( () => {
			expect( screen.getByRole( 'menuitemradio', { name: /^Balanced/ } ) ).not.toHaveAttribute(
				'aria-disabled'
			);
		} );
	} );

	it( 'unlocks the paid tiers for Automatticians without purchased credits', async () => {
		connectorMocks.getAuthUser.mockResolvedValue( { id: 1, email: 'person@automattic.com' } );
		connectorMocks.getStudioAssistantQuota.mockResolvedValue( { purchasedRemaining: 0 } );
		renderComposer();

		fireEvent.click( screen.getByRole( 'button', { name: 'Model' } ) );
		await waitFor( () => {
			expect( screen.getByRole( 'menuitemradio', { name: /^Balanced/ } ) ).not.toHaveAttribute(
				'aria-disabled'
			);
		} );
		expect( screen.getByRole( 'menuitemradio', { name: /^Strong/ } ) ).not.toHaveAttribute(
			'aria-disabled'
		);
	} );

	it( 'shows Stop while a run is busy and the draft is empty, and queues otherwise', () => {
		const onInterrupt = vi.fn< () => Promise< void > >();
		renderComposer( { busy: true, onInterrupt } );

		fireEvent.click( screen.getByRole( 'button', { name: 'Stop response' } ) );
		expect( onInterrupt ).toHaveBeenCalledTimes( 1 );

		fireEvent.change( screen.getByRole( 'combobox' ), { target: { value: 'And then this' } } );
		expect( screen.getByRole( 'button', { name: 'Queue message' } ) ).toBeEnabled();
	} );

	it( 'keeps the draft until the send is accepted, clearing only what was sent', async () => {
		let acceptSend: () => void = () => {};
		const onSend = vi.fn(
			() =>
				new Promise< void >( ( resolve ) => {
					acceptSend = resolve;
				} )
		);
		renderComposer( { onSend } );
		const textarea = screen.getByRole( 'combobox' );

		fireEvent.change( textarea, { target: { value: 'First message' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Send message' } ) );
		expect( textarea ).toHaveValue( 'First message' );

		await act( async () => acceptSend() );
		expect( textarea ).toHaveValue( '' );

		fireEvent.change( textarea, { target: { value: 'Second message' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Send message' } ) );
		fireEvent.change( textarea, { target: { value: 'Second message, edited meanwhile' } } );
		await act( async () => acceptSend() );
		expect( textarea ).toHaveValue( 'Second message, edited meanwhile' );
	} );

	it( 'keeps the draft when the send is rejected', async () => {
		const onSend = vi.fn().mockRejectedValue( new Error( 'network error' ) );
		const firstRender = renderComposer( { onSend } );
		fireEvent.change( screen.getByRole( 'combobox' ), { target: { value: 'Retry this draft' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Send message' } ) );
		await waitFor( () => expect( onSend ).toHaveBeenCalled() );
		firstRender.unmount();

		renderComposer();
		expect( screen.getByRole( 'combobox' ) ).toHaveValue( 'Retry this draft' );
	} );

	it( 'holds sends behind the out-of-credits notice and flags a blocked send', async () => {
		connectorMocks.getStudioAssistantQuota.mockResolvedValue( {
			costCap: 100,
			studioCodeAiHasAccess: true,
			studioCodeAiAccess: 'granted',
			hasPaymentMethod: true,
			allowanceRemaining: 0,
			purchasedRemaining: 0,
		} );
		const onSend = vi.fn< ( prompt: string ) => Promise< void > >();
		renderComposer( { onSend } );

		const notice = await screen.findByRole( 'alert' );
		expect( notice ).toHaveTextContent( 'Add AI credits to send another message.' );
		expect( within( notice ).getByRole( 'button', { name: 'Add credits' } ) ).toBeInTheDocument();

		fireEvent.change( screen.getByRole( 'combobox' ), { target: { value: 'One more' } } );
		fireEvent.keyDown( screen.getByRole( 'combobox' ), { key: 'Enter' } );
		expect( onSend ).not.toHaveBeenCalled();
		expect( notice ).toHaveAttribute( 'data-feedback' );
		expect( screen.getByRole( 'combobox' ) ).toHaveValue( 'One more' );
	} );

	it( 'turns auto-start on from the add menu and off from its chip', async () => {
		renderComposer( { canAutoStart: true } );

		fireEvent.click( screen.getByRole( 'button', { name: 'Add' } ) );
		fireEvent.click( await screen.findByRole( 'menuitem', { name: /^Auto-start/ } ) );
		await waitFor( () =>
			expect( connectorMocks.setUserPreferences.mock.calls[ 0 ][ 0 ] ).toEqual( {
				autoStartSiteOnChat: true,
			} )
		);

		fireEvent.click( await screen.findByRole( 'button', { name: 'Remove Auto-start' } ) );
		await waitFor( () =>
			expect( connectorMocks.setUserPreferences.mock.calls[ 1 ][ 0 ] ).toEqual( {
				autoStartSiteOnChat: false,
			} )
		);
	} );

	it( 'answers a pending question with typed text, but still queues skill commands', async () => {
		const onSend = vi.fn< ( prompt: string ) => Promise< void > >();
		const onAnswer = vi.fn();
		renderComposer( { busy: true, onSend, onAnswer } );

		const textarea = screen.getByPlaceholderText( 'Your answer' );
		fireEvent.change( textarea, { target: { value: 'Something warmer' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Send answer' } ) );

		expect( onAnswer ).toHaveBeenCalledWith( 'Something warmer' );
		expect( textarea ).toHaveValue( '' );

		fireEvent.change( textarea, { target: { value: '/annotate' } } );
		fireEvent.click( screen.getByRole( 'button', { name: 'Queue message' } ) );

		await waitFor( () => expect( onSend ).toHaveBeenCalledTimes( 1 ) );
		expect( onSend.mock.calls[ 0 ][ 0 ] ).toBe( '/annotate' );
		expect( onAnswer ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'shows a flyout affordance and skill descriptions', async () => {
		renderComposer();

		fireEvent.click( screen.getByRole( 'button', { name: 'Add' } ) );

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

		const attachmentItem = await screen.findByRole( 'listitem', { name: /^notes\.txt/ } );
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

	it( 'restores text and attachments independently for each session', async () => {
		const firstSession = renderComposer();
		fireEvent.change( screen.getByRole( 'combobox' ), {
			target: { value: 'Keep this draft for session one' },
		} );
		const textFile = new File( [ 'Attachment text' ], 'notes.txt', {
			type: 'text/plain',
		} );
		fireEvent.change(
			firstSession.container.querySelector( 'input[type="file"]' ) as HTMLInputElement,
			{ target: { files: [ textFile ] } }
		);
		await screen.findByRole( 'listitem', { name: /^notes\.txt/ } );
		firstSession.rerenderComposer( { sessionId: 'session-2' } );
		expect( screen.getByRole( 'combobox' ) ).toHaveValue( '' );
		expect( screen.queryByRole( 'listitem' ) ).not.toBeInTheDocument();
		fireEvent.change( screen.getByRole( 'combobox' ), {
			target: { value: 'A different draft for session two' },
		} );

		firstSession.rerenderComposer();
		expect( screen.getByRole( 'combobox' ) ).toHaveValue( 'Keep this draft for session one' );
		expect( screen.getByRole( 'listitem', { name: /^notes\.txt/ } ) ).toBeInTheDocument();
	} );

	it( 'restores the suggestion baseline with its session draft', async () => {
		const firstSession = renderComposer();
		act( () => {
			firstSession.composerRef.current?.replaceDraft( 'A suggested prompt', {
				suggestionBaseline: 'A suggested prompt',
			} );
		} );
		await waitFor( () =>
			expect( firstSession.composerRef.current?.getDraft() ).toEqual( {
				text: 'A suggested prompt',
				hasAttachments: false,
				suggestionBaseline: 'A suggested prompt',
			} )
		);

		firstSession.rerenderComposer( { sessionId: 'session-2' } );
		firstSession.rerenderComposer();

		expect( firstSession.composerRef.current?.getDraft() ).toEqual( {
			text: 'A suggested prompt',
			hasAttachments: false,
			suggestionBaseline: 'A suggested prompt',
		} );
	} );

	it( 'clears the cached draft after sending', async () => {
		const onSend = vi.fn().mockResolvedValue( undefined );
		const firstRender = renderComposer( { onSend } );
		fireEvent.change( screen.getByRole( 'combobox' ), {
			target: { value: 'Send and clear this draft' },
		} );
		fireEvent.click( screen.getByRole( 'button', { name: 'Send message' } ) );
		await waitFor( () =>
			expect( onSend ).toHaveBeenCalledWith( 'Send and clear this draft', {
				files: [],
				images: [],
			} )
		);
		firstRender.unmount();

		renderComposer();
		expect( screen.getByRole( 'combobox' ) ).toHaveValue( '' );
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
			await screen.findByRole( 'listitem', { name: /^pasted-image\.png/ } )
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
		expect( screen.queryByRole( 'listitem' ) ).not.toBeInTheDocument();

		dialog.remove();
	} );

	it( 'keeps the picked provider pin in the fresh session cache after a family switch', async () => {
		const queryClient = new QueryClient();
		const onSwitchSession = vi.fn();
		const freshSummary = createSummary( { id: 'fresh-session' } );
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

		fireEvent.click( screen.getByRole( 'button', { name: 'Model' } ) );
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

// Model items carry a description after the name.
function getMenuLabels() {
	return screen.getAllByRole( 'menuitemradio' ).map( ( item ) => item.textContent );
}

const startingWith = ( labels: string[] ) =>
	labels.map( ( label ) => expect.stringMatching( new RegExp( `^${ label }` ) ) );

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
