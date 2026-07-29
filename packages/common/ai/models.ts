import { isStudioCustomEntryOfType } from './sessions/entry-types';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';

export type AiModelFamily = 'anthropic' | 'openai';

export interface AiModel {
	/** Stable model id sent to the upstream provider. */
	id: string;
	/** Human-readable label shown in the model picker. */
	label: string;
	/**
	 * Bare model name, for prose that already supplies the context — e.g. the
	 * composer's "Chatting with Sonnet AI". Not derivable from `label`: the
	 * distinguishing word is the last one for OpenAI and the first for
	 * Anthropic.
	 */
	shortLabel: string;
	/** Which runtime serves this model. Drives `pickRuntime` in agent.ts. */
	family: AiModelFamily;
}

// Pro / o-series OpenAI variants (`gpt-*-pro`, `o[1-9]*`) are intentionally
// excluded: their long reasoning turns can exceed the proxy/SDK timeout
// window. (Routing is no longer a blocker — the OpenAI family now goes
// through the proxy's `/v1/responses` path, which supports reasoning models
// and function tools.)
export const AI_MODELS = [
	{ id: 'claude-sonnet-5', label: 'Sonnet 5', shortLabel: 'Sonnet', family: 'anthropic' },
	{ id: 'claude-opus-5', label: 'Opus 5', shortLabel: 'Opus', family: 'anthropic' },
	{ id: 'gpt-5.6-sol', label: 'GPT 5.6 Sol', shortLabel: 'Sol', family: 'openai' },
] as const satisfies readonly AiModel[];

export type AiModelId = ( typeof AI_MODELS )[ number ][ 'id' ];

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

export function getAiModelShortLabel( id: AiModelId ): string {
	return getAiModel( id ).shortLabel;
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
 * auto-switches to `DEFAULT_MODEL` rather than pinning a dead id. Sessions
 * that recorded no model — e.g. a brand-new session before the first turn
 * runs — also fall back to `DEFAULT_MODEL`.
 */
export function resolveSessionModel( entries: SessionEntry[] ): AiModelId {
	for ( let index = entries.length - 1; index >= 0; index -= 1 ) {
		const recordedModel = readEntryModelId( entries[ index ] );
		if ( recordedModel === undefined ) continue;
		return isAiModelId( recordedModel ) ? recordedModel : DEFAULT_MODEL;
	}
	return DEFAULT_MODEL;
}
