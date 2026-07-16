import { DEFAULT_MODEL } from '@studio/common/ai/models';
import { AI_SKILL_COMMANDS } from '@studio/common/ai/slash-commands';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Tooltip } from '@wordpress/ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSIONS_QUERY_KEY } from '@/data/queries/use-sessions';
import { Composer } from '.';
import type { ComposerSendAttachments } from './use-composer-attachments';
import type { AiSessionSummary, LoadedAiSession, SessionEntry } from '@/data/core';
import type { ComponentProps } from 'react';

const connectorMocks = vi.hoisted( () => ( {
	createSession: vi.fn(),
	getFilePath: vi.fn( ( file: File ) => `/tmp/studio-attachments/${ file.name }` ),
	setSessionModel: vi.fn(),
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
			expect( screen.getByText( AI_SKILL_COMMANDS[ 0 ].description ) ).toBeInTheDocument();
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
		const textarea = screen.getByRole( 'textbox' ) as HTMLTextAreaElement;
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
		const textarea = screen.getByRole( 'textbox' ) as HTMLTextAreaElement;
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
		const textarea = screen.getByRole( 'textbox' ) as HTMLTextAreaElement;
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

	it( 'keeps the picked model in the fresh session cache after a family switch', async () => {
		const queryClient = new QueryClient();
		const onSwitchSession = vi.fn();
		const freshSummary = createSummary( { id: 'fresh-session' } );
		connectorMocks.createSession.mockResolvedValue( freshSummary );
		connectorMocks.setSessionModel.mockResolvedValue( undefined );

		renderComposer(
			{
				entries: [ createUserPromptEntry() ],
				ownerSiteId: 'site-1',
				onSwitchSession,
			},
			queryClient
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Select model' } ) );
		fireEvent.click( await screen.findByText( 'GPT 5.6 Sol' ) );
		fireEvent.click( await screen.findByRole( 'button', { name: 'Start new conversation' } ) );

		await waitFor( () => {
			expect( onSwitchSession ).toHaveBeenCalledWith( 'fresh-session' );
		} );
		expect( connectorMocks.setSessionModel ).toHaveBeenCalledWith( 'fresh-session', 'gpt-5.6-sol' );

		const loadedSession = queryClient.getQueryData< LoadedAiSession >( [
			...SESSIONS_QUERY_KEY,
			'fresh-session',
		] );
		expect( loadedSession?.summary ).toEqual( freshSummary );
		expect( loadedSession?.entries ).toEqual( [
			expect.objectContaining( {
				type: 'model_change',
				modelId: 'gpt-5.6-sol',
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
