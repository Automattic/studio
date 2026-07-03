/**
 * @jest-environment node
 */
import { describe, expect, it } from 'vitest';
import { entriesToRenderItems } from './index';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';

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
