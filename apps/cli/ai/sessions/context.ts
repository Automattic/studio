import { resolveSessionModel, type SelectedModelId } from '@studio/common/ai/models';
import { isStudioCustomEntryOfType } from '@studio/common/ai/sessions/entry-types';
import { AI_PROVIDERS, type AiProviderId } from 'cli/ai/providers';
import type { LoadedAiSession } from '@studio/common/ai/sessions/types';

function isAiProviderId( value: string ): value is AiProviderId {
	return Object.prototype.hasOwnProperty.call( AI_PROVIDERS, value );
}

export interface ResumeSessionContext {
	sessionId?: string;
	provider?: AiProviderId;
	model?: SelectedModelId;
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

	// Shared resolution: the most recent recorded model wins, and a removed
	// model auto-switches to the default so resumed sessions never pin a
	// model we no longer offer.
	context.model = resolveSessionModel( resumeSession.entries );

	for ( let index = resumeSession.entries.length - 1; index >= 0; index -= 1 ) {
		const entry = resumeSession.entries[ index ];

		if ( isStudioCustomEntryOfType( entry, 'studio.session_context' ) ) {
			const data = entry.data;
			if ( data && isAiProviderId( data.provider ) ) {
				context.provider = data.provider;
				break;
			}
		}
	}

	return context;
}
