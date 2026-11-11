import {
	readRecordedSessionModel,
	resolveSessionProvider,
} from '@studio/agent/protocol/sessions/model';
import type { LoadedAiSession } from '@studio/agent/protocol/sessions/types';
import type { AiModelId, ProviderId } from '@studio/providers';

export interface ResumeSessionContext {
	sessionId?: string;
	provider?: ProviderId;
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

	context.provider = resolveSessionProvider( resumeSession.entries );

	return context;
}
