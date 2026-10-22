import { __ } from '@wordpress/i18n';
import { isStudioCustomEntryOfType } from './sessions/entry-types';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';

export type AiModelFamily = 'anthropic' | 'studio' | 'openai';

export interface AiModel {
	/** Stable model id sent to the upstream provider. */
	id: string;
	/** Human-readable label shown in the model picker. */
	label: string;
	/** Which runtime serves this model. Drives `pickRuntime` in agent.ts. */
	family: AiModelFamily;
	/**
	 * Whether the model accepts image input. Defaults to true for built-in
	 * models (ids outside this catalog default to false). Set false for
	 * text-only models so the runtime doesn't advertise vision they lack —
	 * screenshot tool results are images.
	 */
	supportsImages?: boolean;
	/**
	 * Pickers disable the model unless purchased AI credits remain
	 * (Automatticians exempt). UI gating only — the wpcom proxy enforces
	 * access, and `isAiModelId` never consults this.
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

/**
 * A model id the user has selected to run. It is usually a built-in
 * `AiModelId`, but the `openai-compatible` provider lets the user run an
 * arbitrary model served by a local endpoint, whose id is not in `AI_MODELS`.
 * The `( string & {} )` member keeps editor autocomplete for the known ids
 * while still accepting any string.
 */
export type SelectedModelId = AiModelId | ( string & {} );

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

/**
 * Resolve a model's family. Built-in ids map to their declared family;
 * unknown ids (e.g. a local model served through the `openai-compatible`
 * provider) default to `'openai'`, since those endpoints speak the OpenAI
 * wire protocol.
 */
export function getAiModelFamily( id: SelectedModelId ): AiModelFamily {
	return MODEL_BY_ID.get( id )?.family ?? 'openai';
}

// The tier labels are plain adjectives (unlike the Anthropic brand names), so
// they go through i18n — as thunks, since module-level `__()` is banned.
const TRANSLATED_MODEL_LABELS: Partial< Record< AiModelId, () => string > > = {
	fast: () => __( 'Fast' ),
	balanced: () => __( 'Balanced' ),
	strong: () => __( 'Strong' ),
};

/**
 * Human-readable label for a model. Unknown ids (e.g. a local model served
 * through the `openai-compatible` provider) have no built-in label, so the id
 * itself is shown.
 */
export function getAiModelLabel( id: SelectedModelId ): string {
	return TRANSLATED_MODEL_LABELS[ id as AiModelId ]?.() ?? MODEL_BY_ID.get( id )?.label ?? id;
}

export function aiModelRequiresPaidCredits( id: AiModelId ): boolean {
	return getAiModel( id ).requiresPaidAiCredits ?? false;
}

// Tolerates ids outside AI_MODELS (e.g. a local `openai-compatible` model).
// Those are assumed text-only: most local models reject an image content block
// outright, so advertising a screenshot tool would make every call 400. A
// built-in model that doesn't say otherwise still takes images.
export function aiModelSupportsImages( id: SelectedModelId ): boolean {
	const model = MODEL_BY_ID.get( id );
	if ( ! model ) {
		return false;
	}
	return model.supportsImages ?? true;
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
 * The most recently recorded model, returned verbatim — including ids that
 * aren't in `AI_MODELS`, since the `openai-compatible` provider runs arbitrary
 * local models whose ids must survive resume. Undefined when the session never
 * recorded one, so callers can apply their own default. Callers that can only
 * use a built-in id narrow with `isAiModelId` / `providerServesModel`.
 */
export function readRecordedSessionModel( entries: SessionEntry[] ): SelectedModelId | undefined {
	for ( let index = entries.length - 1; index >= 0; index -= 1 ) {
		const recordedModel = readEntryModelId( entries[ index ] );
		if ( recordedModel !== undefined ) {
			return recordedModel;
		}
	}
	return undefined;
}

/** `readRecordedSessionModel` with a fallback for sessions without one. */
export function resolveSessionModel(
	entries: SessionEntry[],
	defaultModel: AiModelId = DEFAULT_MODEL
): SelectedModelId {
	return readRecordedSessionModel( entries ) ?? defaultModel;
}
