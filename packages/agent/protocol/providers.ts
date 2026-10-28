import {
	AI_MODELS,
	DEFAULT_MODEL,
	getAiModelFamily,
	PAID_DEFAULT_MODEL,
	resolveSessionModel,
	type AiModelFamily,
	type AiModelId,
} from '@studio/agent/protocol/models';
import { isStudioCustomEntryOfType } from '@studio/agent/protocol/sessions/entry-types';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';

// The literal entries of AI_MODELS, so `id` stays the `AiModelId` union
// instead of widening to `string` for callers that key off it.
type AiProviderModel = ( typeof AI_MODELS )[ number ];

// Persisted in shared.json (`aiProvider`), so treat the list as append-only:
// readers narrow with `isAiProviderId` and fall back to the default on values
// they don't know.
export const AI_PROVIDER_IDS = [ 'wpcom', 'anthropic-api-key', 'custom-endpoint' ] as const;

export type AiProviderId = ( typeof AI_PROVIDER_IDS )[ number ];

export const DEFAULT_AI_PROVIDER: AiProviderId = 'wpcom';

// Brand names, not translated.
export const AI_PROVIDER_LABELS: Record< AiProviderId, string > = {
	wpcom: 'WordPress.com',
	'anthropic-api-key': 'Anthropic API',
	'custom-endpoint': 'Custom endpoint',
};

// Which model families each provider can service. `wpcom` serves only the
// studio capability tiers (resolved to upstream models by the proxy);
// direct-API providers are restricted to their own family. The custom
// endpoint's models are the ones its connection names, so none are listed here.
const PROVIDER_MODEL_FAMILIES: Record< AiProviderId, readonly AiModelFamily[] > = {
	wpcom: [ 'studio' ],
	'anthropic-api-key': [ 'anthropic' ],
	'custom-endpoint': [ 'custom' ],
};

// Precomputed so callers get a stable reference (the composer calls this per
// render), mirroring MODEL_BY_ID in models.ts.
const PROVIDER_MODELS: ReadonlyMap< AiProviderId, readonly AiProviderModel[] > = new Map(
	AI_PROVIDER_IDS.map(
		( provider ) =>
			[
				provider,
				AI_MODELS.filter( ( model ) =>
					PROVIDER_MODEL_FAMILIES[ provider ].includes( model.family )
				),
			] as const
	)
);

export function isAiProviderId( value: string ): value is AiProviderId {
	return ( AI_PROVIDER_IDS as readonly string[] ).includes( value );
}

export function getAiProviderModels( provider: AiProviderId ): readonly AiProviderModel[] {
	return PROVIDER_MODELS.get( provider ) ?? [];
}

export function providerServesModel( provider: AiProviderId, model: AiModelId ): boolean {
	return getAiModelFamily( model ) === 'custom'
		? provider === 'custom-endpoint'
		: getAiProviderModels( provider ).some( ( entry ) => entry.id === model );
}

/**
 * The fallback when no model was chosen or the provider can't serve the
 * requested one. On wpcom, the balanced tier when the paid tiers are unlocked;
 * everyone else (including callers without quota data) gets fast.
 */
export function getAiProviderDefaultModel(
	provider: AiProviderId,
	options?: { canUsePaidModels?: boolean }
): AiModelId {
	if ( provider === 'wpcom' && options?.canUsePaidModels ) {
		return PAID_DEFAULT_MODEL;
	}
	return getAiProviderModels( provider )[ 0 ]?.id ?? DEFAULT_MODEL;
}

/**
 * `resolveSessionModel` constrained to what the provider can serve: a
 * recorded model it no longer offers snaps to the provider's default.
 */
export function resolveSessionModelForProvider(
	entries: SessionEntry[],
	provider: AiProviderId,
	options?: { canUsePaidModels?: boolean }
): AiModelId {
	const defaultModel = getAiProviderDefaultModel( provider, options );
	const model = resolveSessionModel( entries, defaultModel );
	return providerServesModel( provider, model ) ? model : defaultModel;
}

/**
 * The provider a session is pinned to: the latest `studio.session_context`
 * entry naming a provider wins. Only explicit switches record one (per-turn
 * records carry just the model), so pins survive fallback runs. Undefined
 * when never pinned — callers fall back to the saved global selection.
 */
export function resolveSessionProvider( entries: SessionEntry[] ): AiProviderId | undefined {
	for ( let index = entries.length - 1; index >= 0; index -= 1 ) {
		const entry = entries[ index ];
		if ( isStudioCustomEntryOfType( entry, 'studio.session_context' ) ) {
			const provider = entry.data?.provider;
			if ( provider && isAiProviderId( provider ) ) {
				return provider;
			}
		}
	}
	return undefined;
}

/**
 * The provider a conversation effectively runs on: its pinned choice first,
 * then the saved global selection. A provider the app cannot run (no saved
 * Anthropic key, missing/unloaded settings, or the custom endpoint, which only
 * the CLI connects so far) leaves WordPress.com.
 */
export function getEffectiveSessionProvider(
	entries: SessionEntry[],
	settings?: Pick< AiSettings, 'provider' | 'hasAnthropicApiKey' > | null
): AiProviderId {
	const provider = resolveSessionProvider( entries ) ?? settings?.provider;
	return provider === 'anthropic-api-key' && settings?.hasAnthropicApiKey
		? provider
		: DEFAULT_AI_PROVIDER;
}

/**
 * The AI provider settings exposed to the settings UI. The Anthropic API key
 * itself never leaves the server — only its presence and a short suffix for
 * display.
 */
export interface AiSettings {
	provider: AiProviderId;
	hasAnthropicApiKey: boolean;
	/** Truncated key for display (`sk-ant-…abcd`), or null when none is saved. */
	anthropicApiKeyPreview: string | null;
}
