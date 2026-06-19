import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Conversation, entriesToRenderItems } from './index';
import type { LoadedAiSession, SessionEntry } from '@/data/core';

vi.mock( '@/components/markdown', () => ( {
	Markdown: ( { children }: { children: string } ) => children,
} ) );

vi.mock( '@wordpress/ui', () => ( {
	Icon: () => null,
} ) );

vi.mock( '../thinking-indicator', () => ( {
	ThinkingIndicator: () => null,
} ) );

describe( 'Conversation tool rows', () => {
	it( 'keeps tool inputs and results hidden until the label row is clicked', () => {
		const data = loadedSession( [
			assistantToolCallEntry( 'Bash', { command: 'npm test' } ),
			toolResultEntry( 'first output line\nsecond output line' ),
		] );

		renderConversation( data );

		expect( screen.queryByText( 'npm test' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( /first output line/ ) ).not.toBeInTheDocument();

		const toolRow = screen.getByRole( 'button', { name: 'Run terminal command' } );
		expect( toolRow ).toHaveAttribute( 'aria-expanded', 'false' );

		fireEvent.click( toolRow );

		expect( toolRow ).toHaveAttribute( 'aria-expanded', 'true' );
		expect( screen.getByText( 'npm test' ) ).toBeInTheDocument();
		expect( screen.getByText( /first output line/ ) ).toBeInTheDocument();

		fireEvent.click( toolRow );

		expect( toolRow ).toHaveAttribute( 'aria-expanded', 'false' );
		expect( screen.queryByText( /first output line/ ) ).not.toBeInTheDocument();
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

		renderConversation( data );

		expect( screen.queryByRole( 'button', { name: 'Show more' } ) ).not.toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'Run terminal command' } ) );

		expect( screen.getByText( /output line 13/ ) ).toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Show more' } ) ).not.toBeInTheDocument();
		expect( screen.queryByRole( 'button', { name: 'Show less' } ) ).not.toBeInTheDocument();
	} );

	it( 'uses WP-CLI summaries while preserving the raw command in details', () => {
		const command =
			'post list --post_type=post --post_status=publish --fields=ID,post_title --format=table';
		const data = loadedSession( [
			assistantToolCallEntry( 'wp_cli', { nameOrPath: "Shaun's Blog", command } ),
			toolResultEntry( 'ID\tpost_title\n1\tHello world' ),
		] );

		renderConversation( data );

		const toolRow = screen.getByRole( 'button', { name: 'List published posts' } );
		expect( toolRow ).toBeInTheDocument();
		expect( screen.queryByText( /--fields=ID/ ) ).not.toBeInTheDocument();

		fireEvent.click( toolRow );

		expect(
			screen.getByText( ( content ) => content.includes( `wp ${ command }` ) )
		).toBeInTheDocument();
	} );

	it( 'hides the raw Ask User tool row while showing the question UI', () => {
		const data = loadedSession( [
			assistantToolCallEntry( 'AskUserQuestion', {
				questions: [
					{
						question: "What kind of vibe do you want for your blog's design?",
						options: [
							{ label: 'Minimal & Clean', description: '' },
							{ label: 'Warm & Cozy', description: '' },
						],
					},
				],
			} ),
			agentQuestionEntry( "What kind of vibe do you want for your blog's design?", [
				'Minimal & Clean',
				'Warm & Cozy',
			] ),
		] );

		renderConversation( data );

		expect( screen.queryByText( 'Ask user' ) ).not.toBeInTheDocument();
		expect(
			screen.getByText( "What kind of vibe do you want for your blog's design?" )
		).toBeInTheDocument();
		expect( screen.getByRole( 'button', { name: 'Minimal & Clean' } ) ).toBeInTheDocument();
	} );
} );

describe( 'Conversation Ask User questions', () => {
	it( 'shows option descriptions and a selected historical answer', () => {
		const question = "What kind of vibe do you want for your blog's design?";
		const data = loadedSession( [
			agentQuestionEntry(
				question,
				[
					{
						label: 'Minimal & Clean',
						description: 'Quiet typography, generous spacing, and simple structure.',
					},
					{
						label: 'Bold & Editorial',
						description: 'Large headlines, sharp contrast, and magazine-style pacing.',
					},
				],
				'question',
				'Bold & Editorial'
			),
		] );

		renderConversation( data );

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
	} );

	it( 'resolves picked answers positionally for a multi-question batch', () => {
		const items = entriesToRenderItems( [
			agentQuestionEntry( 'Install Jetpack?', [ 'Yes', 'No' ], 'q1' ),
			agentQuestionEntry( 'Activate dark mode?', [ 'Yes', 'No' ], 'q2' ),
			askUserAnswerEntry( 'a1', 'No' ),
			askUserAnswerEntry( 'a2', 'Yes' ),
		] );

		expect( items ).toMatchObject( [
			{ kind: 'agent-question', question: 'Install Jetpack?', pickedLabel: 'No' },
			{ kind: 'agent-question', question: 'Activate dark mode?', pickedLabel: 'Yes' },
		] );
	} );

	it( 'highlights no answer when a question batch has fewer answers than questions', () => {
		const items = entriesToRenderItems( [
			agentQuestionEntry( 'Install Jetpack?', [ 'Yes', 'No' ], 'q1' ),
			agentQuestionEntry( 'Activate dark mode?', [ 'Yes', 'No' ], 'q2' ),
			askUserAnswerEntry( 'a1', 'Yes' ),
		] );

		expect( items ).toMatchObject( [
			{ kind: 'agent-question', question: 'Install Jetpack?', pickedLabel: undefined },
			{ kind: 'agent-question', question: 'Activate dark mode?', pickedLabel: undefined },
		] );
	} );
} );

function renderConversation( data: LoadedAiSession ) {
	return render(
		createElement( Conversation, {
			data,
			isRunning: false,
			startedAt: null,
			pendingQuestions: new Set< string >(),
			pendingAnswers: {},
			onAnswerQuestion: vi.fn(),
		} )
	);
}

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

function agentQuestionEntry(
	question: string,
	options: Array< string | { label: string; description: string } >,
	id = 'question',
	selectedLabel?: string
): SessionEntry {
	return {
		type: 'custom',
		id,
		parentId: null,
		timestamp: '2026-06-05T12:00:01.000Z',
		customType: 'studio.agent_question',
		data: {
			question,
			options: options.map( ( option ) =>
				typeof option === 'string' ? { label: option, description: '' } : option
			),
			...( selectedLabel ? { selectedLabel } : {} ),
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
