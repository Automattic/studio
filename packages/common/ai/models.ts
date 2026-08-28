import { isStudioCustomEntryOfType } from './sessions/entry-types';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';

export type AiModelFamily = 'anthropic' | 'openai' | 'hosted';

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
	 * Hide the model from pickers for non-Automatticians. Visibility only —
	 * the wpcom proxy is what actually refuses these upstreams, so this never
	 * gates `isAiModelId`: a session that already recorded one must still
	 * resolve rather than silently snap back to the default.
	 */
	requiresAutomattician?: boolean;
}

// Pro / o-series OpenAI variants (`gpt-*-pro`, `o[1-9]*`) are intentionally
// excluded: their long reasoning turns can exceed the proxy/SDK timeout
// window. (Routing is no longer a blocker — the OpenAI family now goes
// through the proxy's `/v1/responses` path, which supports reasoning models
// and function tools.)
export const AI_MODELS = [
	{ id: 'claude-sonnet-5', label: 'Sonnet 5', family: 'anthropic' },
	{ id: 'claude-opus-5', label: 'Opus 5', family: 'anthropic' },
	{ id: 'gpt-5.6-sol', label: 'GPT 5.6 Sol', family: 'openai' },
	{ id: 'gpt-5.6-luna', label: 'GPT 5.6 Luna', family: 'openai', requiresAutomattician: true },
	// Hosted models keep their vendor-prefixed ids — the proxy passes them
	// upstream verbatim.
	{ id: 'moonshotai/Kimi-K3', label: 'Kimi K3', family: 'hosted', requiresAutomattician: true },
	{
		id: 'moonshotai/Kimi-K2.6',
		label: 'Kimi K2.6',
		family: 'hosted',
		requiresAutomattician: true,
	},
	{
		id: 'zai-org/GLM-5.3-Flash',
		label: 'GLM 5.3 Flash',
		family: 'hosted',
		supportsImages: false,
		requiresAutomattician: true,
	},
	{
		id: 'zai-org/GLM-5.2',
		label: 'GLM 5.2',
		family: 'hosted',
		supportsImages: false,
		requiresAutomattician: true,
	},
	{
		id: 'zai-org/GLM-5.2-Fast',
		label: 'GLM 5.2 Fast',
		family: 'hosted',
		supportsImages: false,
		requiresAutomattician: true,
	},
	{
		id: 'deepseek-ai/DeepSeek-V4-Pro',
		label: 'DeepSeek V4 Pro',
		family: 'hosted',
		supportsImages: false,
		requiresAutomattician: true,
	},
	{
		id: 'deepseek-ai/DeepSeek-V4-Flash-0731',
		label: 'DeepSeek V4 Flash',
		family: 'hosted',
		supportsImages: false,
		requiresAutomattician: true,
	},
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

// Widened to AiModel: `as const satisfies` narrows each entry to its own
// literal type, so the optional flags aren't on the union.
const ALL_MODELS = AI_MODELS as readonly AiModel[];
const UNRESTRICTED_MODELS = ALL_MODELS.filter( ( model ) => ! model.requiresAutomattician );

/**
 * The models to offer in a picker. Restricted models stay in `AI_MODELS` (so
 * ids keep validating) but are withheld from anyone who isn't an Automattician.
 *
 * `keepId` is always offered even when restricted, so a picker never hides the
 * value it is currently displaying.
 */
export function getVisibleAiModels(
	isAutomattician: boolean,
	keepId?: AiModelId
): readonly AiModel[] {
	const visible = isAutomattician ? ALL_MODELS : UNRESTRICTED_MODELS;
	if ( ! keepId || visible.some( ( model ) => model.id === keepId ) ) {
		return visible;
	}
	return [ ...visible, getAiModel( keepId ) ];
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
