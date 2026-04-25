import type { AiSessionEvent } from './sessions/types';

// Pro / o-series OpenAI variants (`gpt-*-pro`, `o[1-9]*`) are intentionally
// excluded: they're reasoning-only models that, with our current Responses-API
// path through the wpcom AI proxy, take long enough to reason that turns time
// out before producing a final reply. Re-enable once we either (a) tune the
// proxy/SDK timeout window or (b) wire reasoning effort + streaming to keep
// pro turns bounded.
export const AI_MODELS = {
	'claude-sonnet-4-6': 'Sonnet 4.6',
	'claude-opus-4-6': 'Opus 4.6',
	'claude-opus-4-7': 'Opus 4.7',
	'gpt-5.5': 'GPT 5.5',
} as const;

export type AiModelId = keyof typeof AI_MODELS;

export const DEFAULT_MODEL: AiModelId = 'claude-sonnet-4-6';

export function isAiModelId( value: string ): value is AiModelId {
	return Object.prototype.hasOwnProperty.call( AI_MODELS, value );
}

export type AiModelFamily = 'anthropic' | 'openai';

export function getAiModelFamily( model: AiModelId ): AiModelFamily {
	if ( model.startsWith( 'gpt-' ) || model.startsWith( 'o1-' ) || model.startsWith( 'o3-' ) ) {
		return 'openai';
	}
	return 'anthropic';
}

/**
 * Derive the current model for a session from its events.
 *
 * Prefers the most recent `session.model_selected` override (written when the
 * user picks a model from the UI) over the `session.context.model` that the
 * CLI records per turn. Falls back to `DEFAULT_MODEL` for sessions that have
 * neither — e.g. a brand-new session before the first turn runs.
 */
export function resolveSessionModel( events: AiSessionEvent[] ): AiModelId {
	for ( let index = events.length - 1; index >= 0; index -= 1 ) {
		const event = events[ index ];
		if ( event.type === 'session.model_selected' && isAiModelId( event.model ) ) {
			return event.model;
		}
		if ( event.type === 'session.context' && isAiModelId( event.model ) ) {
			return event.model;
		}
	}
	return DEFAULT_MODEL;
}
