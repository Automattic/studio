import { describe, expect, it } from 'vitest';
import {
	entriesToRenderItems,
	entriesToTranscriptItems,
} from '@/features/chats/session-view/conversation/transcript-items';
import type { SessionEntry } from '@/data/core';

const prompt = ( id: string, text: string, source = 'prompt' ) =>
	( {
		type: 'custom',
		id,
		customType: 'studio.user_prompt',
		data: { text, source },
	} ) as SessionEntry;

it( 'pairs tool results and preserves diffs without exposing media payload lines', () => {
	const entries = [
		{
			type: 'message',
			id: 'assistant',
			message: {
				role: 'assistant',
				content: [
					{
						type: 'toolCall',
						id: 'tool-1',
						name: 'write_file',
						arguments: { path: 'style.css' },
					},
				],
			},
		},
		{
			type: 'message',
			id: 'result',
			message: {
				role: 'toolResult',
				toolCallId: 'tool-1',
				content: [ { type: 'text', text: 'Done\nmediaWidgetPayload=secret' } ],
				isError: false,
			},
		},
	] as unknown as SessionEntry[];
	expect( entriesToRenderItems( entries ) ).toContainEqual(
		expect.objectContaining( {
			kind: 'tool-use',
			result: expect.objectContaining( { text: 'Done', isError: false } ),
		} )
	);
} );

it( 'gives each question in a batch a distinct stable identity', () => {
	const entries = [ 'first', 'second' ].map( ( id ) => ( {
		id,
		type: 'custom',
		customType: 'studio.agent_question',
		data: { question: id, options: [] },
	} ) ) as unknown as SessionEntry[];
	const batch = entriesToRenderItems( entries )[ 0 ];
	expect( batch.kind ).toBe( 'agent-question-batch' );
	if ( batch.kind === 'agent-question-batch' ) {
		expect( new Set( batch.questions.map( ( question ) => question.key ) ).size ).toBe( 2 );
	}
} );

describe( 'turn activity', () => {
	const time = ( seconds: number ) =>
		new Date( Date.UTC( 2026, 9, 19, 12, 0, seconds ) ).toISOString();
	const user = ( id: string, seconds = 0 ) =>
		( { ...prompt( id, 'Update my site' ), timestamp: time( seconds ) } ) as SessionEntry;
	const assistant = ( id: string, text: string, tool = false ) =>
		( {
			type: 'message',
			id,
			timestamp: time( 5 ),
			message: {
				role: 'assistant',
				content: [
					{ type: 'text', text },
					...( tool
						? [
								{
									type: 'toolCall',
									id: id + '-tool',
									name: 'Read',
									arguments: { path: 'style.css' },
								},
						  ]
						: [] ),
				],
			},
		} ) as unknown as SessionEntry;
	const close = ( id: string, status = 'success', seconds = 10 ) =>
		( {
			type: 'custom',
			id,
			customType: 'studio.turn_closed',
			timestamp: time( seconds ),
			data: { status },
		} ) as SessionEntry;

	it( 'keeps question answers within the turn and pairs results with their tool call', () => {
		const result = {
			type: 'message',
			id: 'result',
			message: {
				role: 'toolResult',
				toolCallId: 'read-tool',
				content: [ { type: 'text', text: 'CSS contents' } ],
				isError: false,
			},
		} as unknown as SessionEntry;
		const items = entriesToTranscriptItems( [
			user( 'prompt' ),
			assistant( 'read', 'Reading', true ),
			prompt( 'answer', 'Blue', 'ask_user' ),
			result,
			assistant( 'final', 'Done' ),
			close( 'closed' ),
		] );
		expect( items.filter( ( item ) => item.kind === 'activity' ) ).toHaveLength( 1 );
		expect( items.find( ( item ) => item.kind === 'tool-use' ) ).toMatchObject( {
			result: { text: 'CSS contents' },
		} );
	} );

	it( 'does not invent timing for old transcripts and preserves stopped status', () => {
		const items = entriesToTranscriptItems( [
			prompt( 'prompt', 'Hello' ),
			assistant( 'read', 'Checking', true ),
			{ ...close( 'closed', 'interrupted' ), timestamp: 'invalid' },
		] );
		expect( items.find( ( item ) => item.kind === 'activity' ) ).toMatchObject( {
			status: 'interrupted',
			startedAt: null,
			endedAt: null,
		} );
	} );

	it( 'only marks the latest unfinished turn as running', () => {
		const items = entriesToTranscriptItems(
			[
				user( 'first' ),
				assistant( 'first-read', 'Checking', true ),
				close( 'closed' ),
				user( 'second', 20 ),
			],
			{ running: true, startedAt: Date.parse( time( 20 ) ) }
		);
		expect(
			items.filter( ( item ) => item.kind === 'activity' ).map( ( item ) => item.status )
		).toEqual( [ 'success', 'running' ] );
	} );
} );

it( 'restores image attachments under the annotation that owns them', () => {
	const image = {
		kind: 'image',
		id: 'image-1',
		name: 'reference.png',
		mimeType: 'image/png',
		size: 1,
		previewDataUrl: 'data:image/png;base64,eA==',
	};
	const entry = {
		type: 'custom',
		id: 'annotated',
		customType: 'studio.user_prompt',
		data: {
			source: 'prompt',
			text: '2 annotations submitted',
			attachments: [ image ],
			visualAnnotations: [ { comment: 'First note' }, { comment: '', imageIds: [ 'image-1' ] } ],
		},
	} as SessionEntry;
	expect( entriesToRenderItems( [ entry ] ) ).toMatchObject( [
		{ text: 'First note', attachments: [] },
		{ text: '', attachments: [ image ] },
	] );
} );

it( 'keeps files and unclaimed images visible once alongside annotated messages', () => {
	const file = { kind: 'file', id: 'file', name: 'reference.css', mimeType: 'text/css', size: 20 };
	const ordinaryImage = {
		kind: 'image',
		id: 'ordinary',
		name: 'chat.png',
		mimeType: 'image/png',
		size: 1,
	};
	const noteImage = { ...ordinaryImage, id: 'note-image', name: 'note.png' };
	const entry = {
		type: 'custom',
		id: 'annotated',
		customType: 'studio.user_prompt',
		data: {
			source: 'prompt',
			text: 'Apply these changes',
			attachments: [ file, ordinaryImage, noteImage ],
			visualAnnotations: [
				{ comment: 'Apply these changes' },
				{ comment: 'Change heading', imageIds: [ 'note-image' ] },
			],
		},
	} as SessionEntry;
	expect( entriesToRenderItems( [ entry ] ) ).toMatchObject( [
		{ text: 'Apply these changes', attachments: [ file, ordinaryImage ] },
		{ text: 'Change heading', attachments: [ noteImage ] },
	] );
} );
