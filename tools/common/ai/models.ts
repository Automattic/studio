import type { AiSessionEvent } from './sessions/types';

export type AiModelFamily = 'anthropic' | 'openai';

export interface AiModel {
	/** Stable model id sent to the upstream provider. */
	id: string;
	/** Human-readable label shown in the model picker. */
	label: string;
	/** Which runtime serves this model. Drives `pickRuntime` in agent.ts. */
	family: AiModelFamily;
}

// Pro / o-series OpenAI variants (`gpt-*-pro`, `o[1-9]*`) are intentionally
// excluded: they're reasoning-only models that, with our current Chat
// Completions path through the wpcom AI proxy, return HTTP 400 ("only
// supported in v1/responses"). Re-enable once we either route them through
// `/v1/responses` server-side or extend the proxy/SDK timeout window for
// reasoning turns.
export const AI_MODELS = [
	{ id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', family: 'anthropic' },
	{ id: 'claude-opus-4-6', label: 'Opus 4.6', family: 'anthropic' },
	{ id: 'claude-opus-4-7', label: 'Opus 4.7', family: 'anthropic' },
	{ id: 'gpt-5.5', label: 'GPT 5.5', family: 'openai' },
] as const satisfies readonly AiModel[];

export type AiModelId = ( typeof AI_MODELS )[ number ][ 'id' ];

export const DEFAULT_MODEL: AiModelId = 'claude-sonnet-4-6';

// Module-scoped lookup so `getAiModelFamily` / `getAiModelLabel` are O(1)
// and don't re-scan the array per call. Keyed by id; values are the same
// frozen objects as in `AI_MODELS`.
const MODEL_BY_ID: ReadonlyMap< string, AiModel > = new Map(
	AI_MODELS.map( ( model ) => [ model.id, model ] )
);

export function isAiModelId( value: string ): value is AiModelId {
	return MODEL_BY_ID.has( value );
}

/**
 * Look up a model entry by id. The `AiModelId` type guarantees existence,
 * so this never returns `undefined` for typed inputs — callers handling
 * arbitrary strings should narrow with `isAiModelId` first.
 */
export function getAiModel( id: AiModelId ): AiModel {
	// Non-null assertion is safe: AiModelId is the union of the array's ids.
	return MODEL_BY_ID.get( id )!;
}

export function getAiModelFamily( id: AiModelId ): AiModelFamily {
	return getAiModel( id ).family;
}

export function getAiModelLabel( id: AiModelId ): string {
	return getAiModel( id ).label;
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
