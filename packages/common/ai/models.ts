import { __ } from '@wordpress/i18n';
import { isStudioCustomEntryOfType } from './sessions/entry-types';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';

export type AiModelFamily = 'anthropic' | 'studio';

export interface AiModel {
	/** Stable model id sent to the upstream provider. */
	id: string;
	/** Human-readable label shown in the model picker. */
	label: string;
	/** Which runtime serves this model. Drives `pickRuntime` in agent.ts. */
	family: AiModelFamily;
	/**
	 * Whether the model accepts image input. Defaults to true. Set false for
	 * text-only models so the runtime doesn't advertise vision they lack —
	 * screenshot tool results are images.
	 */
	supportsImages?: boolean;
	/**
	 * Offered only to accounts with purchased AI credits remaining — pickers
	 * disable the model for free-allowance accounts. UI gating only; the wpcom
	 * proxy is what actually enforces access, and `isAiModelId` never consults
	 * this: a session that already recorded the model must still resolve.
	 */
	requiresPaidAiCredits?: boolean;
}

// The `studio` family are capability tiers, not concrete models: the wpcom
// proxy's `studio-agent` lane resolves each alias to an upstream model
// server-side, so the mapping can be retuned without a client release. The
// `anthropic` family exists for the direct Anthropic · API key provider only.
export const AI_MODELS = [
	{ id: 'fast', label: 'Fast', family: 'studio', supportsImages: false },
	{ id: 'balanced', label: 'Balanced', family: 'studio', requiresPaidAiCredits: true },
	{ id: 'strong', label: 'Strong', family: 'studio', requiresPaidAiCredits: true },
	{ id: 'claude-sonnet-5', label: 'Sonnet 5', family: 'anthropic' },
	{ id: 'claude-opus-5', label: 'Opus 5', family: 'anthropic' },
] as const satisfies readonly AiModel[];

export type AiModelId = ( typeof AI_MODELS )[ number ][ 'id' ];

export const DEFAULT_MODEL: AiModelId = 'fast';
// Accounts with purchased AI credits remaining default to the balanced tier
// instead (see `getAiProviderDefaultModel`).
export const PAID_DEFAULT_MODEL: AiModelId = 'balanced';

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

// The tier labels are plain adjectives, unlike the brand-name labels of the
// Anthropic models, so they go through i18n. Thunks, not values — module-level
// `__()` calls are banned (studio/no-module-level-translations).
const TRANSLATED_MODEL_LABELS: Partial< Record< AiModelId, () => string > > = {
	fast: () => __( 'Fast' ),
	balanced: () => __( 'Balanced' ),
	strong: () => __( 'Strong' ),
};

export function getAiModelLabel( id: AiModelId ): string {
	return TRANSLATED_MODEL_LABELS[ id ]?.() ?? getAiModel( id ).label;
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
 * The most recently recorded model id in a session's pi entries, verbatim (no
 * validation), or `undefined` when the session never recorded one. Callers
 * that need a usable model should go through `resolveSessionModel`; this
 * exists so they can also tell "no model recorded" from "a model we no longer
 * offer" and apply their own default to both.
 */
export function readRecordedSessionModel( entries: SessionEntry[] ): string | undefined {
	for ( let index = entries.length - 1; index >= 0; index -= 1 ) {
		const recordedModel = readEntryModelId( entries[ index ] );
		if ( recordedModel !== undefined ) {
			return recordedModel;
		}
	}
	return undefined;
}

/**
 * Derive the current model for a session from its pi entries.
 *
 * The most recently recorded model wins. If it names a model we no longer
 * offer (e.g. one that was removed from `AI_MODELS`), the session
 * auto-switches to `defaultModel` rather than pinning a dead id. Sessions
 * that recorded no model — e.g. a brand-new session before the first turn
 * runs — also fall back to `defaultModel`.
 */
export function resolveSessionModel(
	entries: SessionEntry[],
	defaultModel: AiModelId = DEFAULT_MODEL
): AiModelId {
	const recordedModel = readRecordedSessionModel( entries );
	if ( recordedModel !== undefined && isAiModelId( recordedModel ) ) {
		return recordedModel;
	}
	return defaultModel;
}
