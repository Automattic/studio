import { isAiModelId, type AiModelId } from '@studio/common/ai/models';
import { AI_PROVIDERS, type AiProviderId } from 'cli/ai/providers';
import type { LoadedAiSession } from '@studio/common/ai/sessions/types';

function isAiProviderId( value: string ): value is AiProviderId {
	return Object.prototype.hasOwnProperty.call( AI_PROVIDERS, value );
}

export interface ResumeSessionContext {
	sessionId?: string;
	provider?: AiProviderId;
	model?: AiModelId;
}

// Walks a loaded session's events (which `loadAiSession` translates from the
// pi-format JSONL) and resolves the values needed to resume:
// - sessionId: the pi `SessionHeader.id`
// - model: the most recent user-selected model
// - provider: the most recent provider written via `session.context`
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

	for ( let i = resumeSession.events.length - 1; i >= 0; i -= 1 ) {
		const event = resumeSession.events[ i ];

		// `session.model_selected` is a UI-side override (set from the
		// composer dropdown). Prefer it over the per-turn `session.context`
		// model so the user's pick wins on the next turn.
		if ( ! context.model && event.type === 'session.model_selected' ) {
			if ( isAiModelId( event.model ) ) {
				context.model = event.model;
			}
		}

		if ( event.type === 'session.context' ) {
			if ( ! context.provider && isAiProviderId( event.provider ) ) {
				context.provider = event.provider;
			}
			if ( ! context.model && isAiModelId( event.model ) ) {
				context.model = event.model;
			}
		}

		if ( context.sessionId && context.provider && context.model ) {
			break;
		}
	}

	return context;
}
