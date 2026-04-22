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

export function resolveResumeSessionContext(
	resumeSession?: LoadedAiSession
): ResumeSessionContext {
	if ( ! resumeSession ) {
		return {};
	}

	const context: ResumeSessionContext = {};
	const linkedSessionId = resumeSession.summary.agentSessionId?.trim();
	if ( linkedSessionId ) {
		context.sessionId = linkedSessionId;
	}

	for ( let index = resumeSession.events.length - 1; index >= 0; index -= 1 ) {
		const event = resumeSession.events[ index ];

		if ( ! context.sessionId && event.type === 'sdk.message' ) {
			const sessionId = ( event.message as { session_id?: unknown } ).session_id;
			if ( typeof sessionId === 'string' && sessionId.trim().length > 0 ) {
				context.sessionId = sessionId;
			}
		}

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
