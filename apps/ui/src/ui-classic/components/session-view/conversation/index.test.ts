import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
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
} );
