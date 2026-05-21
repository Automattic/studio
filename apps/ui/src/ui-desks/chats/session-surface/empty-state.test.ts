import { describe, expect, it } from 'vitest';
import { hasVisibleUserPrompt, shouldShowEmptyConversation } from './empty-state';
import type { SessionEntry } from '@mariozechner/pi-coding-agent';

describe( 'desks chat empty state', () => {
	it( 'detects user-visible prompt entries', () => {
		expect(
			hasVisibleUserPrompt( [
				{
					type: 'custom',
					customType: 'studio.user_prompt',
					timestamp: '2026-05-21T10:00:00.000Z',
					data: { source: 'prompt', text: 'Create a home page' },
				} as SessionEntry,
			] )
		).toBe( true );
	} );

	it( 'ignores ask-user answers because they are not rendered as user prompts', () => {
		expect(
			hasVisibleUserPrompt( [
				{
					type: 'custom',
					customType: 'studio.user_prompt',
					timestamp: '2026-05-21T10:00:00.000Z',
					data: { source: 'ask_user', text: 'Yes, continue' },
				} as SessionEntry,
			] )
		).toBe( false );
	} );

	it( 'hides suggestions once a prompt is submitted before entries update', () => {
		expect(
			shouldShowEmptyConversation( {
				hasVisibleUserPrompt: false,
				hasSubmittedPrompt: true,
				hasPendingInitialPrompt: false,
				hasActiveRun: false,
				queuedPromptCount: 0,
			} )
		).toBe( false );
	} );

	it( 'hides suggestions for pending initial prompts and queued prompts', () => {
		expect(
			shouldShowEmptyConversation( {
				hasVisibleUserPrompt: false,
				hasSubmittedPrompt: false,
				hasPendingInitialPrompt: true,
				hasActiveRun: false,
				queuedPromptCount: 0,
			} )
		).toBe( false );

		expect(
			shouldShowEmptyConversation( {
				hasVisibleUserPrompt: false,
				hasSubmittedPrompt: false,
				hasPendingInitialPrompt: false,
				hasActiveRun: false,
				queuedPromptCount: 1,
			} )
		).toBe( false );
	} );
} );
