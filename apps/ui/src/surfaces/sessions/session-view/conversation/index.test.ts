import { fireEvent, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Conversation, entriesToRenderItems } from './index';
import type { LoadedAiSession, SessionEntry } from '@/data/core';

function createSession( entries: SessionEntry[] ): LoadedAiSession {
	return {
		entries,
	} as LoadedAiSession;
}

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

	it( 'pairs persisted ask-user answers with their question', () => {
		const items = entriesToRenderItems( [
			{
				type: 'custom',
				id: 'question',
				parentId: null,
				timestamp: '2026-06-02T12:00:00.000Z',
				customType: 'studio.agent_question',
				data: {
					question: 'Which path should I take?',
					options: [
						{ label: 'Upload files', description: 'Upload each file directly.' },
						{ label: 'Use public URLs', description: 'Point the template at public URLs.' },
					],
				},
			},
			{
				type: 'custom',
				id: 'answer',
				parentId: null,
				timestamp: '2026-06-02T12:00:00.001Z',
				customType: 'studio.user_prompt',
				data: {
					text: 'Use public URLs',
					source: 'ask_user',
				},
			},
		] as SessionEntry[] );

		expect( items ).toMatchObject( [
			{
				kind: 'agent-question',
				question: 'Which path should I take?',
				answeredLabel: 'Use public URLs',
			},
		] );
	} );
} );

describe( 'Conversation', () => {
	it( 'describes and collapses tool activity until the accordion is expanded', () => {
		const data = createSession( [
			{
				type: 'message',
				id: 'assistant',
				parentId: null,
				timestamp: '2026-06-02T12:00:00.000Z',
				message: {
					role: 'assistant',
					content: [
						{
							type: 'toolCall',
							id: 'tool-call-1',
							name: 'Read',
							arguments: { file_path: '/tmp/themes/style.css' },
						},
						{
							type: 'toolCall',
							id: 'tool-call-2',
							name: 'Bash',
							arguments: { command: 'npm test' },
						},
					],
				},
			},
			{
				type: 'message',
				id: 'tool-result',
				parentId: null,
				timestamp: '2026-06-02T12:00:00.001Z',
				message: {
					role: 'toolResult',
					toolCallId: 'tool-call-1',
					content: [ { type: 'text', text: 'body { color: red; }' } ],
					isError: false,
				},
			},
			{
				type: 'message',
				id: 'tool-result-2',
				parentId: null,
				timestamp: '2026-06-02T12:00:00.002Z',
				message: {
					role: 'toolResult',
					toolCallId: 'tool-call-2',
					content: [ { type: 'text', text: 'Tests passed' } ],
					isError: false,
				},
			},
		] as SessionEntry[] );

		render(
			createElement( Conversation, {
				data,
				isRunning: false,
				startedAt: null,
				pendingQuestions: new Set< string >(),
				pendingAnswers: {},
				onAnswerQuestion: () => undefined,
			} )
		);

		const activityToggle = screen.getByRole( 'button', {
			name: /Read themes\/style\.css and ran npm test/i,
		} );
		expect( activityToggle ).toHaveAttribute( 'aria-expanded', 'false' );
		const panelId = activityToggle.getAttribute( 'aria-controls' );
		expect( panelId ).toBeTruthy();
		const activityPanel = document.getElementById( panelId as string );
		expect( activityPanel ).toHaveAttribute( 'aria-hidden', 'true' );
		expect( activityToggle ).not.toHaveTextContent( 'Summary' );
		expect( activityToggle ).not.toHaveTextContent( 'step' );
		expect( activityToggle ).not.toHaveTextContent( 'action' );
		expect( activityToggle ).not.toHaveTextContent( 'What I did' );

		fireEvent.click( activityToggle );

		expect( activityToggle ).toHaveAttribute( 'aria-expanded', 'true' );
		expect( activityPanel ).not.toHaveAttribute( 'aria-hidden' );
		expect( screen.getByText( 'Read' ) ).toBeVisible();
		expect( screen.getByText( 'Run' ) ).toBeVisible();
		expect( screen.getByText( 'themes/style.css' ) ).toBeVisible();
		expect( screen.getByText( 'body { color: red; }' ) ).toBeVisible();
		expect( screen.getByText( 'Tests passed' ) ).toBeVisible();
	} );

	it( 'renders agent question option descriptions inline and answers with the label', () => {
		const onAnswerQuestion = vi.fn();
		const question = 'How do you want to get the local poster images onto the live site?';
		const data = createSession( [
			{
				type: 'custom',
				id: 'question',
				parentId: null,
				timestamp: '2026-06-02T12:00:00.000Z',
				customType: 'studio.agent_question',
				data: {
					question,
					options: [
						{
							label: "I'll provide a folder",
							description:
								'Point me to a local folder and I will upload each image to the live media library.',
						},
						{
							label: 'Re-sync uploads',
							description: 'Run the upload sync again, then repair any references that changed.',
						},
					],
				},
			},
		] as SessionEntry[] );

		const { rerender } = render(
			createElement( Conversation, {
				data,
				isRunning: false,
				startedAt: null,
				pendingQuestions: new Set( [ question ] ),
				pendingAnswers: {},
				onAnswerQuestion,
			} )
		);

		const folderOption = screen.getByRole( 'button', { name: /I'll provide a folder/i } );
		const syncOption = screen.getByRole( 'button', { name: /Re-sync uploads/i } );
		expect( screen.getByText( '?' ) ).toBeVisible();
		expect( within( folderOption ).getByText( '1' ) ).toBeVisible();
		expect( within( syncOption ).getByText( '2' ) ).toBeVisible();
		expect(
			screen.getByText(
				'Point me to a local folder and I will upload each image to the live media library.'
			)
		).toBeVisible();
		expect(
			screen.getByText( 'Run the upload sync again, then repair any references that changed.' )
		).toBeVisible();
		expect( folderOption ).not.toHaveAttribute( 'title' );

		const input = document.createElement( 'input' );
		document.body.append( input );
		fireEvent.keyDown( input, { key: '1' } );
		input.remove();
		expect( onAnswerQuestion ).not.toHaveBeenCalled();

		const composer = document.createElement( 'div' );
		composer.setAttribute( 'data-studio-chat-composer', 'true' );
		const composerInput = document.createElement( 'textarea' );
		composer.append( composerInput );
		document.body.append( composer );
		fireEvent.keyDown( composerInput, { key: '2' } );
		composer.remove();
		expect( onAnswerQuestion ).toHaveBeenCalledWith( question, 'Re-sync uploads' );

		onAnswerQuestion.mockClear();
		fireEvent.keyDown( document, { key: '2' } );

		expect( onAnswerQuestion ).toHaveBeenCalledWith( question, 'Re-sync uploads' );

		onAnswerQuestion.mockClear();
		rerender(
			createElement( Conversation, {
				data,
				isRunning: false,
				startedAt: null,
				pendingQuestions: new Set< string >(),
				pendingAnswers: { [ question ]: 'Re-sync uploads' },
				onAnswerQuestion,
			} )
		);

		const pickedSyncOption = screen.getByRole( 'button', { name: /Re-sync uploads/i } );
		expect( within( pickedSyncOption ).queryByText( '2' ) ).not.toBeInTheDocument();

		fireEvent.click( folderOption );

		expect( onAnswerQuestion ).not.toHaveBeenCalled();
	} );
} );
