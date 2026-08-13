import { AI_MODELS, type AiModelFamily } from './models';

// The literal entries of AI_MODELS, so `id` stays the `AiModelId` union
// instead of widening to `string` for callers that key off it.
type AiProviderModel = ( typeof AI_MODELS )[ number ];

// Persisted in shared.json (`aiProvider`), so treat the list as append-only:
// readers narrow with `isAiProviderId` and fall back to the default on values
// they don't know.
export const AI_PROVIDER_IDS = [ 'wpcom', 'anthropic-api-key' ] as const;

export type AiProviderId = ( typeof AI_PROVIDER_IDS )[ number ];

export const DEFAULT_AI_PROVIDER: AiProviderId = 'wpcom';

// Which model families each provider can service. `wpcom` relays both
// Anthropic and OpenAI wire formats through the same proxy; direct-API
// providers are restricted to their own family.
const PROVIDER_MODEL_FAMILIES: Record< AiProviderId, readonly AiModelFamily[] > = {
	wpcom: [ 'anthropic', 'openai' ],
	'anthropic-api-key': [ 'anthropic' ],
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
