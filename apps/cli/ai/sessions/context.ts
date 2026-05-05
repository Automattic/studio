import { isAiModelId, type AiModelId } from '@studio/common/ai/models';
import { isStudioCustomEntryOfType } from '@studio/common/ai/sessions/entry-types';
import { AI_PROVIDERS, type AiProviderId } from 'cli/ai/providers';
import type { SessionEntry } from '@mariozechner/pi-coding-agent';
import type { LoadedAiSession } from '@studio/common/ai/sessions/types';

function isAiProviderId( value: string ): value is AiProviderId {
	return Object.prototype.hasOwnProperty.call( AI_PROVIDERS, value );
}

export interface ResumeSessionContext {
	sessionId?: string;
	provider?: AiProviderId;
	model?: AiModelId;
}

// Walks a loaded pi-format session and resolves the values needed to resume:
// - sessionId: the pi `SessionHeader.id`
// - model: the most recent user-selected model (studio.session_context entry,
//   newer than any `studio.session_model_selected` model_change entry)
// - provider: the most recent provider written to studio.session_context
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

	const entries = resumeSession.entries;
	for ( let i = entries.length - 1; i >= 0; i -= 1 ) {
		const entry = entries[ i ] as SessionEntry;

		if ( ! context.model && entry.type === 'model_change' ) {
			if ( isAiModelId( entry.modelId ) ) {
				context.model = entry.modelId;
			}
		}

		if ( isStudioCustomEntryOfType( entry, 'studio.session_context' ) ) {
			const data = entry.data;
			if ( data ) {
				if ( ! context.provider && isAiProviderId( data.provider ) ) {
					context.provider = data.provider;
				}
				if ( ! context.model && isAiModelId( data.model ) ) {
					context.model = data.model;
				}
			}
		}

		if ( context.sessionId && context.provider && context.model ) {
			break;
		}
	}

	return context;
}
