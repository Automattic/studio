import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Conversation, entriesToRenderItems, isConversationStopped } from './index';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import type { LoadedAiSession } from '@studio/common/ai/sessions/types';

const ipcApiMocks = vi.hoisted( () => ( {
	readLocalMediaFile: vi.fn(),
} ) );

vi.mock( 'src/lib/get-ipc-api', () => ( {
	getIpcApi: () => ipcApiMocks,
} ) );

vi.mock( '../markdown', () => ( {
	Markdown: ( { children }: { children: string } ) => children,
} ) );

vi.mock( '../thinking-indicator', () => ( {
	ThinkingIndicator: () => null,
} ) );

vi.mock( '@wordpress/ui', () => ( {
	Icon: () => null,
} ) );

function customEntry( customType: string, data: unknown ): SessionEntry {
	return {
		type: 'custom',
		id: Math.random().toString( 36 ).slice( 2 ),
		parentId: null,
		timestamp: '2026-06-19T00:00:00.000Z',
		customType,
		data,
	} as unknown as SessionEntry;
}

function question( q: string, options: string[] ): SessionEntry {
	return customEntry( 'studio.agent_question', {
		question: q,
		options: options.map( ( label ) => ( { label, description: '' } ) ),
	} );
}

function answer( text: string ): SessionEntry {
	return customEntry( 'studio.user_prompt', { text, source: 'ask_user' } );
}

function prompt( text: string ): SessionEntry {
	return customEntry( 'studio.user_prompt', { text, source: 'prompt' } );
}

function turnClosed( status: 'completed' | 'interrupted' ): SessionEntry {
	return customEntry( 'studio.turn_closed', { status } );
}

function assistantToolCallEntry( name: string ): SessionEntry {
	return {
		type: 'message',
		id: `assistant-${ name }`,
		parentId: null,
		timestamp: '2026-06-19T00:00:00.000Z',
		message: {
			role: 'assistant',
			content: [
				{
					type: 'toolCall',
					id: 'tool-call-1',
					name,
					arguments: {},
				},
			],
		},
	} as unknown as SessionEntry;
}

function toolResultEntry( text: string ): SessionEntry {
	return {
		type: 'message',
		id: 'tool-result',
		parentId: null,
		timestamp: '2026-06-19T00:00:01.000Z',
		message: {
			role: 'toolResult',
			toolCallId: 'tool-call-1',
			content: [ { type: 'text', text } ],
		},
	} as unknown as SessionEntry;
}

describe( 'entriesToRenderItems – persisted picked answers', () => {
	it( 'pairs a question with its persisted ask_user answer', () => {
		const items = entriesToRenderItems( [ question( 'Pick one', [ 'A', 'B' ] ), answer( 'B' ) ] );
		const q = items.find( ( i ) => i.kind === 'agent-question' );
		expect( q ).toMatchObject( { kind: 'agent-question', question: 'Pick one', answer: 'B' } );
	} );

	it( 'pairs a batch of questions with answers by order', () => {
		// The CLI persists all questions first, then all answers, in question order.
		const items = entriesToRenderItems( [
			question( 'Q1', [ 'A', 'B' ] ),
			question( 'Q2', [ 'C', 'D' ] ),
			answer( 'A' ),
			answer( 'D' ),
		] );
		const questions = items.filter( ( i ) => i.kind === 'agent-question' );
		expect( questions ).toMatchObject( [
			{ question: 'Q1', answer: 'A' },
			{ question: 'Q2', answer: 'D' },
		] );
	} );

	it( 'leaves answer undefined for an unanswered question', () => {
		const items = entriesToRenderItems( [ question( 'Q1', [ 'A', 'B' ] ) ] );
		const q = items.find( ( i ) => i.kind === 'agent-question' );
		expect( q ).toMatchObject( { question: 'Q1', answer: undefined } );
	} );

	it( 'does not render ask_user prompts as user text', () => {
		const items = entriesToRenderItems( [ question( 'Q1', [ 'A' ] ), answer( 'A' ) ] );
		expect( items.some( ( i ) => i.kind === 'user-text' ) ).toBe( false );
	} );
} );

describe( 'isConversationStopped', () => {
	it( 'is false for an in-flight or completed turn', () => {
		expect( isConversationStopped( [ prompt( 'Build me a blog' ) ] ) ).toBe( false );
		expect(
			isConversationStopped( [ prompt( 'Build me a blog' ), turnClosed( 'completed' ) ] )
		).toBe( false );
	} );

	it( 'is true once the latest turn was interrupted', () => {
		expect(
			isConversationStopped( [ prompt( 'Build me a blog' ), turnClosed( 'interrupted' ) ] )
		).toBe( true );
	} );

	it( 'is false again once a newer turn has started', () => {
		expect(
			isConversationStopped( [
				prompt( 'Build me a blog' ),
				turnClosed( 'interrupted' ),
				prompt( 'Actually, a shop' ),
			] )
		).toBe( false );
	} );
} );

describe( 'entriesToRenderItems – legacy payload markers', () => {
	it( 'strips media payload marker lines from any tool output', () => {
		const items = entriesToRenderItems( [
			assistantToolCallEntry( 'take_screenshot' ),
			toolResultEntry(
				'Screenshot captured — desktop: captured full page (1248px tall).\n' +
					'mediaWidgetPayload={"type":"media","widgetProps":{"url":"file:///tmp/screenshot.jpg"}}'
			),
		] );
		const tool = items.find( ( item ) => item.kind === 'tool-use' );

		expect( tool ).toMatchObject( {
			kind: 'tool-use',
			result: {
				text: 'Screenshot captured — desktop: captured full page (1248px tall).',
			},
		} );
		expect( tool ).not.toMatchObject( {
			result: { text: expect.stringContaining( 'mediaWidgetPayload' ) },
		} );
	} );
} );

describe( 'entriesToRenderItems – chat artifacts', () => {
	const screenshotWidget = {
		type: 'media',
		widgetProps: {
			url: 'file:///tmp/studio-screenshot/screenshot-desktop.jpg',
			mediaKind: 'image',
			alt: 'Screenshot of http://localhost:8888/ (desktop)',
			mediaId: null,
			source: {
				type: 'local',
				path: '/tmp/studio-screenshot/screenshot-desktop.jpg',
				name: 'screenshot-desktop.jpg',
				mimeType: 'image/jpeg',
			},
		},
	};

	it( 'renders media widgets from chat artifact entries', () => {
		const items = entriesToRenderItems( [
			customEntry( 'studio.chat_artifact', {
				version: 1,
				id: 'artifact-1',
				widgets: [ screenshotWidget, { type: 'site-preview', widgetProps: { path: '/' } } ],
			} ),
		] );

		expect( items ).toMatchObject( [ { kind: 'chat-artifact', widgets: [ screenshotWidget ] } ] );
	} );

	it( 'ignores artifacts without renderable media widgets', () => {
		const items = entriesToRenderItems( [
			customEntry( 'studio.chat_artifact', {
				version: 1,
				id: 'artifact-1',
				widgets: [ { type: 'site-preview', widgetProps: { path: '/' } } ],
			} ),
		] );

		expect( items ).toEqual( [] );
	} );

	it( 'skips malformed chat artifact entries without crashing', () => {
		const malformed = [
			{ version: 1, id: 'artifact-1' }, // missing widgets
			{ version: 1, id: 'artifact-2', widgets: 'nope' }, // wrong widgets type
			{ id: 'artifact-3', widgets: [] }, // missing version
			null,
		];
		for ( const data of malformed ) {
			expect( entriesToRenderItems( [ customEntry( 'studio.chat_artifact', data ) ] ) ).toEqual(
				[]
			);
		}
	} );
} );

describe( 'Conversation – inline media artifacts', () => {
	beforeEach( () => {
		ipcApiMocks.readLocalMediaFile.mockReset();
	} );

	function localScreenshotWidget( path: string ) {
		return {
			type: 'media',
			widgetProps: {
				url: `file://${ path }`,
				mediaKind: 'image',
				alt: 'Screenshot of http://localhost:8888/ (desktop)',
				mediaId: null,
				source: {
					type: 'local',
					path,
					name: 'screenshot-desktop.jpg',
					mimeType: 'image/jpeg',
				},
			},
		};
	}

	function renderConversation( entries: SessionEntry[] ) {
		render(
			<Conversation
				data={ { entries } as unknown as LoadedAiSession }
				isRunning={ false }
				startedAt={ null }
				pendingQuestions={ new Set() }
				pendingAnswers={ {} }
				answeredQuestions={ {} }
				onAnswerQuestion={ () => {} }
			/>
		);
	}

	it( 'renders local screenshot media artifacts inline', async () => {
		ipcApiMocks.readLocalMediaFile.mockResolvedValue( {
			name: 'screenshot-desktop.jpg',
			mimeType: 'image/jpeg',
			data: new Uint8Array( [ 1, 2, 3 ] ).buffer,
		} );
		// Paths are unique per test: the component caches data URLs by path
		// for the app lifetime.
		const path = '/tmp/studio-screenshot/screenshot-desktop-render.jpg';

		renderConversation( [
			customEntry( 'studio.chat_artifact', {
				version: 1,
				id: 'artifact-1',
				widgets: [ localScreenshotWidget( path ) ],
			} ),
		] );

		const screenshot = await screen.findByRole( 'img', {
			name: 'Screenshot of http://localhost:8888/ (desktop)',
		} );
		expect( screenshot ).toHaveAttribute( 'src', 'data:image/jpeg;base64,AQID' );
		expect( ipcApiMocks.readLocalMediaFile ).toHaveBeenCalledWith( path );
	} );

	it( 'shows a fallback when reading the local file fails', async () => {
		ipcApiMocks.readLocalMediaFile.mockRejectedValue( new Error( 'gone' ) );

		renderConversation( [
			customEntry( 'studio.chat_artifact', {
				version: 1,
				id: 'artifact-1',
				widgets: [
					localScreenshotWidget( '/tmp/studio-screenshot/screenshot-desktop-missing.jpg' ),
				],
			} ),
		] );

		expect( await screen.findByRole( 'status' ) ).toHaveTextContent( 'Image unavailable' );
	} );
} );
