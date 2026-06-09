import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Conversation, entriesToRenderItems } from './index';
import type { LoadedAiSession, SessionEntry } from '@/data/core';

vi.mock( '@/components/markdown', () => ( {
	Markdown: ( { children }: { children: string } ) => children,
} ) );

vi.mock( '../thinking-indicator', () => ( {
	ThinkingIndicator: () => null,
} ) );

describe( 'entriesToRenderItems', () => {
	it( 'attaches image previews to the matching user prompt', () => {
		const items = entriesToRenderItems( [
			{
				type: 'custom',
				id: 'prompt',
				parentId: null,
				timestamp: '2026-06-02T12:00:00.000Z',
				customType: 'studio.user_prompt',
				data: {
					text: 'Use this logo',
					source: 'prompt',
					attachments: [
						{
							id: 'image-1',
							name: 'logo.png',
							mimeType: 'image/png',
							size: 123,
							width: 80,
							height: 40,
						},
					],
				},
			},
			{
				type: 'message',
				id: 'user',
				parentId: null,
				timestamp: '2026-06-02T12:00:00.001Z',
				message: {
					role: 'user',
					content: [
						{ type: 'text', text: 'Use this logo' },
						{ type: 'image', data: 'abc123', mimeType: 'image/png' },
					],
				},
			},
		] as SessionEntry[] );

		expect( items ).toMatchObject( [
			{
				kind: 'user-turn',
				text: 'Use this logo',
				attachments: [
					{
						id: 'image-1',
						name: 'logo.png',
						src: 'data:image/png;base64,abc123',
					},
				],
			},
		] );
	} );

	it( 'resolves picked answers positionally for a multi-question batch', () => {
		// Mirrors how the CLI persists a batch: all questions first, then the
		// answers in question order. Both questions share option labels, so
		// label matching alone would attribute the wrong answer.
		const items = entriesToRenderItems( [
			agentQuestionEntry( 'q1', 'Install Jetpack?', [ 'Yes', 'No' ] ),
			agentQuestionEntry( 'q2', 'Activate dark mode?', [ 'Yes', 'No' ] ),
			askUserAnswerEntry( 'a1', 'No' ),
			askUserAnswerEntry( 'a2', 'Yes' ),
		] );

		expect( items ).toMatchObject( [
			{ kind: 'agent-question', question: 'Install Jetpack?', pickedLabel: 'No' },
			{ kind: 'agent-question', question: 'Activate dark mode?', pickedLabel: 'Yes' },
		] );
	} );

	it( 'highlights no answer when a batch has fewer answers than questions', () => {
		const items = entriesToRenderItems( [
			agentQuestionEntry( 'q1', 'Install Jetpack?', [ 'Yes', 'No' ] ),
			agentQuestionEntry( 'q2', 'Activate dark mode?', [ 'Yes', 'No' ] ),
			askUserAnswerEntry( 'a1', 'Yes' ),
		] );

		expect( items ).toMatchObject( [
			{ kind: 'agent-question', question: 'Install Jetpack?', pickedLabel: undefined },
			{ kind: 'agent-question', question: 'Activate dark mode?', pickedLabel: undefined },
		] );
	} );

	it( 'resolves a single historical question from its persisted answer', () => {
		const items = entriesToRenderItems( [
			agentQuestionEntry( 'q1', 'Install Jetpack?', [ 'Yes', 'No' ] ),
			askUserAnswerEntry( 'a1', 'Yes' ),
		] );

		expect( items ).toMatchObject( [
			{ kind: 'agent-question', question: 'Install Jetpack?', pickedLabel: 'Yes' },
		] );
	} );
} );

describe( 'Conversation tool rows', () => {
	it( 'keeps tool results hidden until the label row is clicked', async () => {
		const data = loadedSession( [
			assistantToolCallEntry( 'Bash', { command: 'npm test' } ),
			toolResultEntry( 'first output line\nsecond output line' ),
		] );

		render(
			createElement( Conversation, {
				data,
				isRunning: false,
				startedAt: null,
				pendingQuestions: new Set< string >(),
				pendingAnswers: {},
				onAnswerQuestion: vi.fn(),
			} )
		);

		expect( screen.queryByText( /first output line/ ) ).not.toBeInTheDocument();

		const toolRow = screen.getByRole( 'button', { name: 'Run terminal command' } );
		expect( toolRow ).toHaveAttribute( 'aria-expanded', 'false' );
		expect( screen.queryByText( 'npm test' ) ).not.toBeInTheDocument();

		fireEvent.click( toolRow );

		expect( toolRow ).toHaveAttribute( 'aria-expanded', 'true' );
		expect( screen.getByText( 'npm test' ) ).toBeInTheDocument();
		expect( screen.getByText( /first output line/ ) ).toBeInTheDocument();

		fireEvent.click( toolRow );

		expect( toolRow ).toHaveAttribute( 'aria-expanded', 'false' );
		await waitFor( () =>
			expect( screen.queryByText( /first output line/ ) ).not.toBeInTheDocument()
		);
	} );

	it( 'shows long tool results in the opened details without an extra toggle', () => {
		const longOutput = Array.from(
			{ length: 13 },
			( _, index ) => `output line ${ index + 1 }`
		).join( '\n' );
		const data = loadedSession( [
			assistantToolCallEntry( 'Bash', { command: 'npm test' } ),
			toolResultEntry( longOutput ),
		] );

		render(
			createElement( Conversation, {
				data,
				isRunning: false,
				startedAt: null,
				pendingQuestions: new Set< string >(),
				pendingAnswers: {},
				onAnswerQuestion: vi.fn(),
			} )
		);

		expect( screen.queryByRole( 'button', { name: 'Show more' } ) ).not.toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'Run terminal command' } ) );

		expect( screen.getByText( /output line 13/ ) ).toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Show more' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Show less' } ) ).not.toBeInTheDocument();
	} );

	it( 'summarizes WP-CLI commands while preserving the raw command in details', () => {
		const command =
			'post list --post_type=post --post_status=publish --fields=ID,post_title,post_date --format=table';
		const data = loadedSession( [
			assistantToolCallEntry( 'wp_cli', { nameOrPath: "Shaun's Blog", command } ),
			toolResultEntry( 'ID\tpost_title\tpost_date\n1\tHello world\t2026-06-05' ),
		] );

		render(
			createElement( Conversation, {
				data,
				isRunning: false,
				startedAt: null,
				pendingQuestions: new Set< string >(),
				pendingAnswers: {},
				onAnswerQuestion: vi.fn(),
			} )
		);

		const toolRow = screen.getByRole( 'button', {
			name: 'List published posts',
		} );
		expect( toolRow ).toBeInTheDocument();
		expect( screen.queryByText( /--fields=ID/ ) ).not.toBeInTheDocument();

		fireEvent.click( toolRow );

		expect( screen.queryByText( 'Command' ) ).not.toBeInTheDocument();
		expect(
			screen.getByText( ( content ) => content.includes( `wp ${ command }` ) )
		).toBeInTheDocument();
		expect( screen.queryByText( /Site: Shaun's Blog/ ) ).not.toBeInTheDocument();
	} );

	it( 'keeps screenshot row details focused on the action', () => {
		const data = loadedSession( [
			assistantToolCallEntry( 'take_screenshot', {
				url: 'http://localhost:8882',
				viewport: 'all',
			} ),
			toolResultEntry( 'Screenshot captured' ),
		] );

		render(
			createElement( Conversation, {
				data,
				isRunning: false,
				startedAt: null,
				pendingQuestions: new Set< string >(),
				pendingAnswers: {},
				onAnswerQuestion: vi.fn(),
			} )
		);

		expect( screen.getByRole( 'button', { name: 'Capture screenshot' } ) ).toBeInTheDocument();
		expect( screen.queryByText( /localhost:8882/ ) ).not.toBeInTheDocument();
		expect( screen.queryByText( /all/ ) ).not.toBeInTheDocument();
	} );

	it( 'keeps annotation browser row details focused on the action', () => {
		const data = loadedSession( [
			assistantToolCallEntry( 'open_annotation_browser', {
				url: 'http://localhost:8882',
			} ),
			toolResultEntry( 'Annotation browser ready' ),
		] );

		render(
			createElement( Conversation, {
				data,
				isRunning: false,
				startedAt: null,
				pendingQuestions: new Set< string >(),
				pendingAnswers: {},
				onAnswerQuestion: vi.fn(),
			} )
		);

		expect( screen.getByRole( 'button', { name: 'Open annotation browser' } ) ).toBeInTheDocument();
		expect( screen.queryByText( /localhost:8882/ ) ).not.toBeInTheDocument();
	} );

	it( 'hides the Ask User tool row while showing the question UI', () => {
		const data = loadedSession( [
			assistantToolCallEntry( 'AskUserQuestion', {
				question: "What kind of vibe do you want for your blog's design?",
			} ),
			{
				type: 'custom',
				id: 'question',
				parentId: null,
				timestamp: '2026-06-05T12:00:01.000Z',
				customType: 'studio.agent_question',
				data: {
					question: "What kind of vibe do you want for your blog's design?",
					options: [
						{ label: 'Minimal & Clean', description: '' },
						{ label: 'Warm & Cozy', description: '' },
					],
				},
			} as SessionEntry,
		] );

		render(
			createElement( Conversation, {
				data,
				isRunning: false,
				startedAt: null,
				pendingQuestions: new Set< string >(),
				pendingAnswers: {},
				onAnswerQuestion: vi.fn(),
			} )
		);

		expect( screen.queryByText( 'Ask user' ) ).not.toBeInTheDocument();
		expect(
			screen.getByText( "What kind of vibe do you want for your blog's design?" )
		).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Minimal & Clean' } ) ).toBeInTheDocument();
	} );

	it( 'shows Ask User option descriptions and a selected historical answer', () => {
		const question = "What kind of vibe do you want for your blog's design?";
		const onAnswerQuestion = vi.fn();
		const data = loadedSession( [
			{
				type: 'custom',
				id: 'question',
				parentId: null,
				timestamp: '2026-06-05T12:00:01.000Z',
				customType: 'studio.agent_question',
				data: {
					question,
					selectedLabel: 'Bold & Editorial',
					options: [
						{
							label: 'Minimal & Clean',
							description: 'Quiet typography, generous spacing, and simple structure.',
						},
						{
							label: 'Bold & Editorial',
							description: 'Large headlines, sharp contrast, and magazine-style pacing.',
						},
					],
				},
			} as SessionEntry,
		] );

		render(
			createElement( Conversation, {
				data,
				isRunning: false,
				startedAt: null,
				pendingQuestions: new Set< string >(),
				pendingAnswers: {},
				onAnswerQuestion,
			} )
		);

		expect( screen.getAllByRole( 'listitem' ) ).toHaveLength( 2 );
		expect(
			screen.getByText( 'Quiet typography, generous spacing, and simple structure.' )
		).toBeInTheDocument();
		expect(
			screen.getByText( 'Large headlines, sharp contrast, and magazine-style pacing.' )
		).toBeInTheDocument();

		const pickedOption = screen.getByRole( 'button', { name: 'Bold & Editorial' } );
		expect( pickedOption ).toHaveAttribute( 'aria-pressed', 'true' );
		expect( pickedOption ).toBeDisabled();

		fireEvent.click( pickedOption );

		expect( onAnswerQuestion ).not.toHaveBeenCalled();
	} );
} );

function loadedSession( entries: SessionEntry[] ): LoadedAiSession {
	return {
		summary: {
			id: 'session-1',
			filePath: '/tmp/session-1.json',
			createdAt: '2026-06-05T12:00:00.000Z',
			updatedAt: '2026-06-05T12:00:00.000Z',
			activeEnvironment: 'local',
			eventCount: entries.length,
		},
		entries,
	};
}

function assistantToolCallEntry(
	name: string,
	args: Record< string, unknown > = {}
): SessionEntry {
	return {
		type: 'message',
		id: `assistant-${ name }`,
		parentId: null,
		timestamp: '2026-06-05T12:00:00.000Z',
		message: {
			role: 'assistant',
			content: [
				{
					type: 'toolCall',
					id: 'tool-call-1',
					name,
					arguments: args,
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
		timestamp: '2026-06-05T12:00:01.000Z',
		message: {
			role: 'toolResult',
			toolCallId: 'tool-call-1',
			content: [ { type: 'text', text } ],
		},
	} as unknown as SessionEntry;
}

function agentQuestionEntry( id: string, question: string, labels: string[] ): SessionEntry {
	return {
		type: 'custom',
		id,
		parentId: null,
		timestamp: '2026-06-05T12:00:01.000Z',
		customType: 'studio.agent_question',
		data: {
			question,
			options: labels.map( ( label ) => ( { label, description: '' } ) ),
		},
	} as SessionEntry;
}

function askUserAnswerEntry( id: string, text: string ): SessionEntry {
	return {
		type: 'custom',
		id,
		parentId: null,
		timestamp: '2026-06-05T12:00:02.000Z',
		customType: 'studio.user_prompt',
		data: {
			text,
			source: 'ask_user',
		},
	} as SessionEntry;
}
