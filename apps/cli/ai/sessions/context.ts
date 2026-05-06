import { isAiModelId, type AiModelId } from '@studio/common/ai/models';
import { isStudioCustomEntryOfType } from '@studio/common/ai/sessions/entry-types';
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

// Walks a loaded session's pi entries and resolves the values needed to
// resume:
// - sessionId: the pi `SessionHeader.id` (already on `summary.id`)
// - model: the most recent `model_change` entry, falling back to the latest
//   `studio.session_context.model`
// - provider: the most recent `studio.session_context.provider`
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

	for ( let index = resumeSession.entries.length - 1; index >= 0; index -= 1 ) {
		const entry = resumeSession.entries[ index ];

		if ( ! context.model && entry.type === 'model_change' ) {
			const modelId = ( entry as { modelId?: unknown } ).modelId;
			if ( typeof modelId === 'string' && isAiModelId( modelId ) ) {
				context.model = modelId;
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
