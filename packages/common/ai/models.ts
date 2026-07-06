import { isStudioCustomEntryOfType } from './sessions/entry-types';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';

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
	{ id: 'claude-opus-4-8', label: 'Opus 4.8', family: 'anthropic' },
	{ id: 'gpt-5.5', label: 'GPT 5.5', family: 'openai' },
] as const satisfies readonly AiModel[];

export type AiModelId = ( typeof AI_MODELS )[ number ][ 'id' ];

/** Model ids as a tuple, for zod enums and other literal-union consumers. */
export const AI_MODEL_IDS = AI_MODELS.map( ( model ) => model.id ) as [ AiModelId, ...AiModelId[] ];

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
 * Read the raw model id recorded on a single session entry, if any.
 *
 * Looks at the `model_change` entry the UI writes when the user picks a model
 * and the `studio.session_context` payload the CLI records per turn. Returns
 * the stored string verbatim (no validation) so callers can distinguish "no
 * model recorded" from "a model we no longer offer".
 */
function readEntryModelId( entry: SessionEntry ): string | undefined {
	if ( entry.type === 'model_change' ) {
		const modelId = ( entry as { modelId?: unknown } ).modelId;
		return typeof modelId === 'string' ? modelId : undefined;
	}
	if ( isStudioCustomEntryOfType( entry, 'studio.session_context' ) ) {
		const model = entry.data?.model;
		return typeof model === 'string' ? model : undefined;
	}
	return undefined;
}

/**
 * Derive the current model for a session from its pi entries.
 *
 * The most recently recorded model wins. If it names a model we no longer
 * offer (e.g. one that was removed from `AI_MODELS`), the session
 * auto-switches to `fallback` rather than pinning a dead id. Sessions that
 * recorded no model — e.g. a brand-new session before the first turn runs —
 * also fall back. Callers pass the user's preferred default model as
 * `fallback` so fresh sessions start on it.
 */
export function resolveSessionModel(
	entries: SessionEntry[],
	fallback: AiModelId = DEFAULT_MODEL
): AiModelId {
	for ( let index = entries.length - 1; index >= 0; index -= 1 ) {
		const recordedModel = readEntryModelId( entries[ index ] );
		if ( recordedModel === undefined ) continue;
		return isAiModelId( recordedModel ) ? recordedModel : fallback;
	}
	return fallback;
}
