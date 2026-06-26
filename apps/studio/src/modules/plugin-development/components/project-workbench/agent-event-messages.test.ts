/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import {
	formatAiReviewEventMessage,
	isInternalAiReviewChatMessage,
	shouldAppendAiReviewEventToChat,
} from './agent-event-messages';
import type { DevelopmentProjectAiReviewEvent } from '@studio/common/types/publishing';

type AiReviewEvent = DevelopmentProjectAiReviewEvent[ 'event' ];

describe( 'formatAiReviewEventMessage', () => {
	it( 'formats progress events for transient Studio Code status', () => {
		expect(
			formatAiReviewEventMessage( {
				type: 'progress',
				timestamp: '2026-06-24T00:00:00.000Z',
				message: 'Reading plugin files',
			} )
		).toBe( 'Reading plugin files' );
	} );

	it( 'does not append lifecycle and progress events to chat', () => {
		expect(
			shouldAppendAiReviewEventToChat( {
				type: 'run.started',
				timestamp: '2026-06-24T00:00:00.000Z',
			} )
		).toBe( false );
		expect(
			shouldAppendAiReviewEventToChat( {
				type: 'progress',
				timestamp: '2026-06-24T00:00:00.000Z',
				message: 'Resuming session 5abd242f-10fb-4b69-9cf3-dc3c1a603985',
			} )
		).toBe( false );
		expect(
			shouldAppendAiReviewEventToChat( {
				type: 'message',
				timestamp: '2026-06-24T00:00:00.000Z',
				message: { type: 'message_end', message: { role: 'assistant', content: [] } },
			} as unknown as AiReviewEvent )
		).toBe( true );
	} );

	it( 'detects previously persisted internal lifecycle messages', () => {
		expect( isInternalAiReviewChatMessage( 'Studio Code started working.' ) ).toBe( true );
		expect(
			isInternalAiReviewChatMessage( 'Resuming session 5abd242f-10fb-4b69-9cf3-dc3c1a603985' )
		).toBe( true );
		expect( isInternalAiReviewChatMessage( 'I found the unsanitized input.' ) ).toBe( false );
	} );

	it( 'formats assistant text and tool calls from message events', () => {
		const event = {
			type: 'message',
			timestamp: '2026-06-24T00:00:00.000Z',
			message: {
				type: 'message_end',
				message: {
					role: 'assistant',
					content: [
						{ type: 'text', text: 'I found the unsanitized input.' },
						{
							type: 'toolCall',
							name: 'apply_patch',
							arguments: { file: 'list-all-urls.php' },
						},
					],
				},
			},
		} as unknown as AiReviewEvent;

		expect( formatAiReviewEventMessage( event ) ).toBe(
			'I found the unsanitized input.\n\nUsing `apply_patch` with `{"file":"list-all-urls.php"}`.'
		);
	} );

	it( 'formats tool output from turn_end events', () => {
		const event = {
			type: 'message',
			timestamp: '2026-06-24T00:00:00.000Z',
			message: {
				type: 'turn_end',
				toolResults: [
					{
						role: 'toolResult',
						content: [ { type: 'text', text: 'Patched one file.' } ],
					},
				],
			},
		} as unknown as AiReviewEvent;

		expect( formatAiReviewEventMessage( event ) ).toBe(
			'Tool output:\n\n```\nPatched one file.\n```'
		);
	} );
} );
