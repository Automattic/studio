import { AI_PROVIDERS, type AiModel } from '@studio/agent/protocol/provider-catalog';
import { isStudioCustomEntryOfType } from '@studio/agent/protocol/sessions/entry-types';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';

export type { AiModel } from '@studio/agent/protocol/provider-catalog';

type CatalogModel = ( typeof AI_PROVIDERS )[ number ][ 'models' ][ number ];
export type AiModelFamily = CatalogModel[ 'family' ];

export const AI_MODELS: readonly CatalogModel[] = AI_PROVIDERS.flatMap< CatalogModel >(
	( provider ) => provider.models
);

export type AiModelId = ( typeof AI_MODELS )[ number ][ 'id' ];

export const DEFAULT_MODEL: AiModelId = 'fast';
// Accounts with purchased AI credits remaining default to the balanced tier
// instead (see `getAiProviderDefaultModel`).
export const PAID_DEFAULT_MODEL: AiModelId = 'balanced';

// Module-scoped lookup so `getAiModelFamily` / `getAiModelLabel` are O(1)
// and don't re-scan the array per call. Keyed by id; values are the same
// frozen objects as in `AI_MODELS`.
const MODEL_BY_ID: ReadonlyMap< string, AiModel & { family: AiModelFamily } > = new Map(
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
export function getAiModel( id: AiModelId ): AiModel & { family: AiModelFamily } {
	// Non-null assertion is safe: AiModelId is the union of the array's ids.
	return MODEL_BY_ID.get( id )!;
}

export function getAiModelFamily( id: AiModelId ): AiModelFamily {
	return getAiModel( id ).family;
}

export function getAiModelLabel( id: AiModelId ): string {
	const model = getAiModel( id );
	return model.getLabel?.() ?? model.label;
}

export function aiModelRequiresPaidCredits( id: AiModelId ): boolean {
	return getAiModel( id ).requiresPaidAiCredits ?? false;
}

// Tolerates ids outside AI_MODELS — callers can reach here with a cast, and
// image support is the safe default.
export function aiModelSupportsImages( id: AiModelId ): boolean {
	return MODEL_BY_ID.get( id )?.supportsImages ?? true;
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
 * The most recently recorded model still in `AI_MODELS`, or `undefined` when
 * the session never recorded one (or only models we no longer offer) — so
 * callers can apply their own default to both cases.
 */
export function readRecordedSessionModel( entries: SessionEntry[] ): AiModelId | undefined {
	for ( let index = entries.length - 1; index >= 0; index -= 1 ) {
		const recordedModel = readEntryModelId( entries[ index ] );
		if ( recordedModel !== undefined && isAiModelId( recordedModel ) ) {
			return recordedModel;
		}
	}
	return undefined;
}

/** `readRecordedSessionModel` with a fallback for sessions without one. */
export function resolveSessionModel(
	entries: SessionEntry[],
	defaultModel: AiModelId = DEFAULT_MODEL
): AiModelId {
	return readRecordedSessionModel( entries ) ?? defaultModel;
}
