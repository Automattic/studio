// Typed helpers for writing Studio's CustomEntry payloads on top of pi's
// SessionManager. `customType` is namespaced with `studio.` so pi's session
// machinery (compaction, branching, summary) ignores them and readers can
// filter cleanly.

import type { SessionManager } from '@mariozechner/pi-coding-agent';
import type {
	StudioAgentQuestionData,
	StudioCustomEntryDataMap,
	StudioCustomEntryType,
	StudioSessionContextData,
	StudioSessionLinkedData,
	StudioSiteSelectedData,
	StudioToolProgressData,
	StudioTurnClosedData,
	StudioUserPromptData,
} from '@studio/common/ai/sessions/entry-types';

function append< T extends StudioCustomEntryType >(
	sm: SessionManager,
	customType: T,
	data: StudioCustomEntryDataMap[ T ]
): string {
	return sm.appendCustomEntry( customType, data );
}

export function appendSiteSelected( sm: SessionManager, data: StudioSiteSelectedData ): string {
	return append( sm, 'studio.site_selected', data );
}

export function appendToolProgress( sm: SessionManager, data: StudioToolProgressData ): string {
	if ( ! data.message.trim() ) {
		// Empty progress messages would just clutter the transcript.
		return '';
	}
	return append( sm, 'studio.tool_progress', data );
}

export function appendAgentQuestion( sm: SessionManager, data: StudioAgentQuestionData ): string {
	return append( sm, 'studio.agent_question', data );
}

export function appendTurnClosed( sm: SessionManager, data: StudioTurnClosedData ): string {
	return append( sm, 'studio.turn_closed', data );
}

export function appendSessionCleared( sm: SessionManager ): string {
	return append( sm, 'studio.session_cleared', {} );
}

export function appendSessionContext( sm: SessionManager, data: StudioSessionContextData ): string {
	return append( sm, 'studio.session_context', data );
}

export function appendSessionLinked( sm: SessionManager, data: StudioSessionLinkedData ): string {
	return append( sm, 'studio.session_linked', data );
}

export function appendUserPrompt( sm: SessionManager, data: StudioUserPromptData ): string {
	return append( sm, 'studio.user_prompt', data );
}
