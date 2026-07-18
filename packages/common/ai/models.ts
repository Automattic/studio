import { isStudioCustomEntryOfType } from './sessions/entry-types';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';

export type AiModelFamily = 'anthropic' | 'openai';

/**
 * How a model accepts extended-thinking requests.
 *
 * - `adaptive`: only `thinking: {type: "adaptive"}` — budget-based requests
 *   (`type: "enabled"` + `budget_tokens`) are rejected with a 400. Applies to
 *   Sonnet 5 / Opus 4.8 and later Anthropic models.
 * - `budget`: budget-based thinking (older Anthropic models).
 * - `none`: never request thinking.
 */
export type AiModelThinking = 'adaptive' | 'budget' | 'none';

export interface AiModel {
	/** Stable model id sent to the upstream provider. */
	id: string;
	/** Human-readable label shown in the model picker. */
	label: string;
	/** Which runtime serves this model. Drives `pickRuntime` in agent.ts. */
	family: AiModelFamily;
	/** Which extended-thinking request shape the model accepts. */
	thinking: AiModelThinking;
}

// Pro / o-series OpenAI variants (`gpt-*-pro`, `o[1-9]*`) are intentionally
// excluded: their long reasoning turns can exceed the proxy/SDK timeout
// window. (Routing is no longer a blocker — the OpenAI family now goes
// through the proxy's `/v1/responses` path, which supports reasoning models
// and function tools.)
export const AI_MODELS = [
	{ id: 'claude-sonnet-5', label: 'Sonnet 5', family: 'anthropic', thinking: 'adaptive' },
	{ id: 'claude-opus-4-8', label: 'Opus 4.8', family: 'anthropic', thinking: 'adaptive' },
	{ id: 'claude-fable-5', label: 'Fable 5', family: 'anthropic', thinking: 'adaptive' },
	{ id: 'gpt-5.6-sol', label: 'GPT 5.6 Sol', family: 'openai', thinking: 'none' },
] as const satisfies readonly AiModel[];

export type AiModelId = ( typeof AI_MODELS )[ number ][ 'id' ];

/** Model ids as a tuple, for zod enums and other literal-union consumers. */
export const AI_MODEL_IDS = AI_MODELS.map( ( model ) => model.id ) as [ AiModelId, ...AiModelId[] ];

export const DEFAULT_MODEL: AiModelId = 'claude-sonnet-5';

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

export function getAiModelThinking( id: AiModelId ): AiModelThinking {
	return getAiModel( id ).thinking;
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
