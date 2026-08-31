import { readRecordedSessionModel, type AiModelId } from '@studio/common/ai/models';
import { isAiProviderId } from '@studio/common/ai/providers';
import { isStudioCustomEntryOfType } from '@studio/common/ai/sessions/entry-types';
import type { LoadedAiSession } from '@studio/common/ai/sessions/types';
import type { AiProviderId } from 'cli/ai/providers';

export interface ResumeSessionContext {
	sessionId?: string;
	provider?: AiProviderId;
	model?: AiModelId;
}

// Resolve provider/model for resume from the most recent `model_change` /
// `studio.session_context` entries.
export function resolveResumeSessionContext(
	resumeSession?: LoadedAiSession
): ResumeSessionContext {
	if ( ! resumeSession ) {
		return {};
	}

	const context: ResumeSessionContext = {};
	if ( resumeSession.summary.id ) {
		context.sessionId = resumeSession.summary.id;
	}

	// Unset when the session recorded no (still-offered) model, so the caller
	// applies its provider-appropriate default instead of pinning a dead id.
	context.model = readRecordedSessionModel( resumeSession.entries );

	for ( let index = resumeSession.entries.length - 1; index >= 0; index -= 1 ) {
		const entry = resumeSession.entries[ index ];

		if ( isStudioCustomEntryOfType( entry, 'studio.session_context' ) ) {
			const data = entry.data;
			if ( data?.provider && isAiProviderId( data.provider ) ) {
				context.provider = data.provider;
				break;
			}
		}
	}

	return context;
}
