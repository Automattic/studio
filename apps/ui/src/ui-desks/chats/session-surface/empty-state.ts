import {
	isStudioCustomEntryOfType,
	type StudioCustomEntry,
} from '@studio/common/ai/sessions/entry-types';
import type { SessionEntry } from '@mariozechner/pi-coding-agent';

interface EmptyConversationState {
	hasVisibleUserPrompt: boolean;
	hasSubmittedPrompt: boolean;
	hasPendingInitialPrompt: boolean;
	hasActiveRun: boolean;
	queuedPromptCount: number;
}

export function hasVisibleUserPrompt( entries: SessionEntry[] | undefined ): boolean {
	return ( entries ?? [] ).some( ( entry ) => {
		if ( ! isStudioCustomEntryOfType( entry, 'studio.user_prompt' ) ) {
			return false;
		}
		const data = ( entry as StudioCustomEntry< 'studio.user_prompt' > ).data;
		return data?.source === 'prompt' && typeof data.text === 'string' && data.text.trim() !== '';
	} );
}

export function shouldShowEmptyConversation( {
	hasVisibleUserPrompt,
	hasSubmittedPrompt,
	hasPendingInitialPrompt,
	hasActiveRun,
	queuedPromptCount,
}: EmptyConversationState ): boolean {
	return (
		! hasVisibleUserPrompt &&
		! hasSubmittedPrompt &&
		! hasPendingInitialPrompt &&
		! hasActiveRun &&
		queuedPromptCount === 0
	);
}
