import { resolveSessionModel, type AiModelId } from '@studio/common/ai/models';
import { resolveSessionProvider } from '@studio/common/ai/providers';
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

	// A model we no longer offer resolves to the default, so resumed sessions
	// never pin something we can't serve.
	context.model = resolveSessionModel( resumeSession.entries );
	context.provider = resolveSessionProvider( resumeSession.entries );

	return context;
}
