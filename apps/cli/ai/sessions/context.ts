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
// `studio.session_context` entries. Both halves share the resolvers in
// `@studio/common/ai`, so resume and the UI agree on what a session is pinned to.
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

	// Shared resolution: the most recent recorded model wins, and a removed
	// model auto-switches to the default so resumed sessions never pin a
	// model we no longer offer.
	context.model = resolveSessionModel( resumeSession.entries );

	const provider = resolveSessionProvider( resumeSession.entries );
	if ( provider ) {
		context.provider = provider;
	}

	return context;
}
