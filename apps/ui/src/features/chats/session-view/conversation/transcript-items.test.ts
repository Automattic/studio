import { describe, expect, it } from 'vitest';
import {
	agentQuestionEntry,
	askUserAnswerEntry,
	assistantTextEntry,
	assistantToolCallEntry,
	promptEntry,
	toolResultEntry,
	turnClosedEntry,
	visualAnnotationsEntry,
} from '@/features/chats/session-view/conversation/test-entries';
import {
	entriesToRenderItems,
	entriesToTranscriptItems,
	getProgressMessage,
	getSender,
} from '@/features/chats/session-view/conversation/transcript-items';
import type { SessionEntry } from '@/data/core';

describe( 'entriesToRenderItems', () => {
	it( 'shows each annotation with its own images, and the rest on the first bubble', () => {
		const image = ( id: string ) => ( {
			kind: 'image' as const,
			id,
			name: `${ id }.png`,
			mimeType: 'image/png' as const,
			size: 1,
		} );
		const entry = {
			type: 'custom',
			id: 'annotated-prompt',
			parentId: null,
			timestamp: '2026-06-05T12:00:02.000Z',
			customType: 'studio.user_prompt',
			data: {
				text: 'Also check spacing',
				source: 'prompt',
				attachments: [ image( 'own' ), image( 'note' ), { kind: 'file', name: 'brief.md' } ],
				visualAnnotations: [
					{ comment: 'Also check spacing', imageIds: [ 'own' ] },
					{ comment: 'Use this photo', tag: 'img', imageIds: [ 'note' ] },
				],
			},
		} as unknown as SessionEntry;

		expect(
			entriesToRenderItems( [ entry ] ).map( ( item ) =>
				item.kind === 'user-text'
					? item.attachments?.map( ( attachment ) => attachment.name )
					: null
			)
		).toEqual( [ [ 'own.png', 'brief.md' ], [ 'note.png' ] ] );
	} );

	it( 'skips malformed chat artifact entries without crashing', () => {
		const malformed = [
			{ version: 1, id: 'artifact-1' }, // missing widgets
			{ version: 1, id: 'artifact-2', widgets: 'nope' }, // wrong widgets type
			{ id: 'artifact-3', widgets: [] }, // missing version
		];
		for ( const data of malformed ) {
			const entry = {
				type: 'custom',
				id: 'chat-artifact',
				parentId: null,
				timestamp: '2026-06-05T12:00:02.000Z',
				customType: 'studio.chat_artifact',
				data,
			} as unknown as SessionEntry;

			expect( entriesToRenderItems( [ entry ] ) ).toEqual( [] );
		}
	} );

	it( 'resolves picked answers positionally for a multi-question batch', () => {
		const items = entriesToRenderItems( [
			agentQuestionEntry( 'Install Jetpack?', [ 'Yes', 'No' ], 'q1' ),
			agentQuestionEntry( 'Activate dark mode?', [ 'Yes', 'No' ], 'q2' ),
			askUserAnswerEntry( 'a1', 'No' ),
			askUserAnswerEntry( 'a2', 'Yes' ),
		] );

		expect( items ).toMatchObject( [
			{
				kind: 'agent-question-batch',
				questions: [
					{ question: 'Install Jetpack?', pickedLabel: 'No' },
					{ question: 'Activate dark mode?', pickedLabel: 'Yes' },
				],
			},
		] );
	} );

	it( 'highlights no answer when a question batch has fewer answers than questions', () => {
		const items = entriesToRenderItems( [
			agentQuestionEntry( 'Install Jetpack?', [ 'Yes', 'No' ], 'q1' ),
			agentQuestionEntry( 'Activate dark mode?', [ 'Yes', 'No' ], 'q2' ),
			askUserAnswerEntry( 'a1', 'Yes' ),
		] );

		expect( items ).toMatchObject( [
			{
				kind: 'agent-question-batch',
				questions: [
					{ question: 'Install Jetpack?', pickedLabel: undefined },
					{ question: 'Activate dark mode?', pickedLabel: undefined },
				],
			},
		] );
	} );

	it( 'pairs each tool call with its result, keeping the diff only when the tool succeeded', () => {
		const diff = '--- a/a.php\n+++ b/a.php\n';
		const edit = ( isError: boolean ) => {
			const result = toolResultEntry( 'Edited', isError ) as { message: object };
			return entriesToRenderItems( [
				assistantToolCallEntry( 'Edit', { file_path: 'a.php' } ),
				{ ...result, message: { ...result.message, details: { diff } } } as SessionEntry,
			] );
		};

		expect( edit( false ) ).toMatchObject( [
			{ kind: 'tool-use', name: 'Edit', result: { text: 'Edited', isError: false, diff } },
		] );
		expect( edit( true ) ).toMatchObject( [ { result: { isError: true, diff: undefined } } ] );
	} );

	it( 'hangs one copy of the whole message off its last text block', () => {
		expect( entriesToRenderItems( [ assistantTextEntry( 'One', ' ', 'Two' ) ] ) ).toMatchObject( [
			{ text: 'One', messageText: 'One\n\nTwo', copyText: undefined },
			{ text: 'Two', messageText: 'One\n\nTwo', copyText: 'One\n\nTwo' },
		] );
	} );

	it( 'keeps media payload lines out of tool results', () => {
		expect(
			entriesToRenderItems( [
				assistantToolCallEntry( 'write_file', { path: 'style.css' } ),
				toolResultEntry( 'Done\nmediaWidgetPayload=secret' ),
			] )
		).toMatchObject( [ { kind: 'tool-use', result: { text: 'Done' } } ] );
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

	it( 'keeps files and unclaimed images visible once alongside annotated messages', () => {
		const file = {
			kind: 'file',
			id: 'file',
			name: 'reference.css',
			mimeType: 'text/css',
			size: 20,
		};
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
} );

describe( 'Turn-closed markers', () => {
	it( 'renders an error marker with the persisted message for errored turns', () => {
		const items = entriesToRenderItems( [
			turnClosedEntry( 'error', 'Monthly usage limit reached: 429 {"type":"error"}' ),
		] );

		expect( items ).toMatchObject( [
			{ kind: 'error-marker', message: 'Monthly usage limit reached: 429 {"type":"error"}' },
		] );
	} );

	it( 'renders no marker for successful turns', () => {
		expect( entriesToRenderItems( [ turnClosedEntry( 'success' ) ] ) ).toEqual( [] );
	} );

	it( 'strips terminal color codes from error markers', () => {
		const escape = String.fromCharCode( 27 );
		const items = entriesToRenderItems( [
			turnClosedEntry( 'error', `${ escape }[31mBuild failed${ escape }[0m` ),
		] );

		expect( items ).toMatchObject( [ { kind: 'error-marker', message: 'Build failed' } ] );
	} );
} );

describe( 'entriesToTranscriptItems', () => {
	it( 'preserves question positions and leaves the final reply outside', () => {
		const items = entriesToTranscriptItems( [
			promptEntry( 'Go' ),
			assistantToolCallEntry( 'Read', { file_path: '/tmp/a.txt' }, 'Let me look.' ),
			toolResultEntry( 'contents' ),
			agentQuestionEntry( 'Which one?', [ 'A', 'B' ] ),
			assistantTextEntry( 'Done.' ),
			turnClosedEntry( 'success' ),
		] );

		expect( items ).toMatchObject( [
			{ kind: 'user-text', text: 'Go' },
			{
				kind: 'activity',
				status: 'success',
				items: [
					{ kind: 'assistant-text', text: 'Let me look.' },
					{ kind: 'tool-use' },
					{ kind: 'agent-question-batch' },
				],
				startedAt: Date.parse( '2026-06-05T12:00:00.000Z' ),
				endedAt: Date.parse( '2026-06-05T12:00:03.000Z' ),
			},
			{ kind: 'assistant-text', text: 'Done.' },
		] );
	} );

	it( 'represents an interrupted turn with only its activity status', () => {
		expect(
			entriesToTranscriptItems( [ promptEntry( 'Go' ), turnClosedEntry( 'interrupted' ) ] )
		).toMatchObject( [
			{ kind: 'user-text' },
			{ kind: 'activity', status: 'interrupted', items: [] },
		] );
	} );

	it( 'counts the open turn from the live run while the agent works', () => {
		const items = entriesToTranscriptItems( [ promptEntry( 'Go' ) ], {
			running: true,
			startedAt: 42,
		} );

		expect( items[ 1 ] ).toMatchObject( {
			kind: 'activity',
			status: 'running',
			startedAt: 42,
			endedAt: null,
		} );
	} );

	it( 'shows tool progress only while it is the running turn’s latest entry', () => {
		const progress = {
			type: 'custom',
			id: 'progress',
			parentId: null,
			timestamp: '2026-06-05T12:00:02.000Z',
			customType: 'studio.tool_progress',
			data: { message: 'Uploading…' },
		} as SessionEntry;
		const entries = [ promptEntry( 'Go' ), assistantToolCallEntry( 'Bash' ), progress ];

		expect( entriesToTranscriptItems( entries, { running: true, startedAt: 1 } ) ).toMatchObject( [
			{ kind: 'user-text' },
			{ kind: 'activity', status: 'running', items: [ { kind: 'tool-use', running: true } ] },
		] );
		expect( getProgressMessage( entries ) ).toBe( 'Uploading…' );
		expect( getProgressMessage( [ ...entries, assistantTextEntry( 'Done.' ) ] ) ).toBeNull();
	} );

	it.each( [ true, false ] )(
		'keeps answered questions before subsequent activity (running: %s)',
		( running ) => {
			const entries = [
				promptEntry( 'Change the background' ),
				assistantTextEntry( 'Checking the current colors.' ),
				agentQuestionEntry( 'Which color?', [ 'Blue', 'Green' ], 'color', 'Blue' ),
				assistantToolCallEntry( 'Read', { file_path: '/tmp/style.css' }, 'I’ll use blue.' ),
				toolResultEntry( 'styles' ),
				assistantTextEntry( 'Updated the background.' ),
				...( running ? [] : [ turnClosedEntry( 'success' ) ] ),
			];
			const items = entriesToTranscriptItems( entries, { running, startedAt: 1 } );
			const activity = items.find( ( item ) => item.kind === 'activity' );
			expect( activity?.items.slice( 0, 4 ) ).toMatchObject( [
				{ kind: 'assistant-text', text: 'Checking the current colors.' },
				{ kind: 'agent-question-batch', questions: [ { pickedLabel: 'Blue' } ] },
				{ kind: 'assistant-text', text: 'I’ll use blue.' },
				{ kind: 'tool-use' },
			] );
			expect( items.some( ( item ) => item.kind === 'agent-question-batch' ) ).toBe( false );
		}
	);

	it( 'preserves partially answered batches in the turn timeline', () => {
		const items = entriesToTranscriptItems(
			[
				promptEntry( 'Update my site' ),
				agentQuestionEntry( 'Which color?', [ 'Blue', 'Green' ], 'color', 'Blue' ),
				agentQuestionEntry( 'Which font?', [ 'Serif', 'Sans' ], 'font' ),
			],
			{ running: true, startedAt: 1 }
		);
		expect( items ).toMatchObject( [
			{ kind: 'user-text' },
			{
				kind: 'activity',
				items: [
					{
						kind: 'agent-question-batch',
						questions: [ { pickedLabel: 'Blue' }, { pickedLabel: undefined } ],
					},
				],
			},
		] );
	} );

	it( 'groups historical answers stored as user prompts with their questions', () => {
		const items = entriesToTranscriptItems(
			[
				promptEntry( 'Update my site' ),
				agentQuestionEntry( 'Which color?', [ 'Blue', 'Green' ] ),
				askUserAnswerEntry( 'answer', 'Blue' ),
				assistantToolCallEntry( 'Read' ),
			],
			{ running: true, startedAt: 1 }
		);
		expect( items.find( ( item ) => item.kind === 'activity' )?.items ).toMatchObject( [
			{ kind: 'agent-question-batch', questions: [ { pickedLabel: 'Blue' } ] },
			{ kind: 'tool-use' },
		] );
	} );

	it( 'leaves a turn with nothing done yet, or text without a prompt, open', () => {
		expect( entriesToTranscriptItems( [ promptEntry( 'Go' ) ] ) ).toHaveLength( 1 );
		expect( entriesToTranscriptItems( [ assistantTextEntry( 'Hi.' ) ] ) ).toHaveLength( 1 );
	} );

	it( 'groups question batches with the assistant’s messages', () => {
		const items = entriesToTranscriptItems( [
			promptEntry( 'Go' ),
			assistantTextEntry( 'Which?' ),
			agentQuestionEntry( 'Which one?', [ 'A', 'B' ] ),
		] );

		expect( items.map( getSender ) ).toEqual( [ 'user', undefined ] );
		expect( items.find( ( item ) => item.kind === 'activity' )?.items.map( getSender ) ).toEqual( [
			'assistant',
			'assistant',
		] );
	} );
} );

describe( 'Visual annotations', () => {
	it( 'renders each submitted annotation as its own user turn', () => {
		const items = entriesToRenderItems( [
			visualAnnotationsEntry( [
				{ comment: 'Make this smaller', tag: 'h1', nearbyText: 'Welcome' },
				{ comment: 'Use a different image', elementLabel: 'img#hero' },
			] ),
		] );

		expect( items ).toMatchObject( [
			{
				kind: 'user-text',
				text: 'Make this smaller',
				annotation: { tag: 'h1', nearbyText: 'Welcome' },
			},
			{
				kind: 'user-text',
				text: 'Use a different image',
				annotation: { elementLabel: 'img#hero' },
			},
		] );
	} );
} );

describe( 'turn activity', () => {
	const time = ( seconds: number ) =>
		new Date( Date.UTC( 2026, 9, 19, 12, 0, seconds ) ).toISOString();
	const user = ( id: string, seconds = 0 ) =>
		( { ...promptEntry( 'Update my site' ), id, timestamp: time( seconds ) } ) as SessionEntry;
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
			askUserAnswerEntry( 'answer', 'Blue' ),
			result,
			assistant( 'final', 'Done' ),
			close( 'closed' ),
		] );
		expect( items.filter( ( item ) => item.kind === 'activity' ) ).toHaveLength( 1 );
		expect(
			items
				.find( ( item ) => item.kind === 'activity' )
				?.items.find( ( item ) => item.kind === 'tool-use' )
		).toMatchObject( {
			result: { text: 'CSS contents' },
		} );
	} );

	it( 'does not invent timing for old transcripts and preserves stopped status', () => {
		const items = entriesToTranscriptItems( [
			{ ...promptEntry( 'Hello' ), timestamp: 'invalid' },
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
