import { AI_MODELS, type AiModel, type AiModelFamily } from './models';

// Kept in sync with `aiProviderSchema` in `apps/cli/lib/cli-config/core.ts`.
// Adding a value here hard-breaks older CLIs reading `cli.json`, so treat the
// list as append-only and coordinate with a config version bump if needed.
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
const PROVIDER_MODELS: Record< AiProviderId, readonly AiModel[] > = Object.fromEntries(
	AI_PROVIDER_IDS.map( ( provider ) => [
		provider,
		AI_MODELS.filter( ( model ) => PROVIDER_MODEL_FAMILIES[ provider ].includes( model.family ) ),
	] )
) as Record< AiProviderId, readonly AiModel[] >;

export function isAiProviderId( value: string ): value is AiProviderId {
	return ( AI_PROVIDER_IDS as readonly string[] ).includes( value );
}

export function getAiProviderModels( provider: AiProviderId ): readonly AiModel[] {
	return PROVIDER_MODELS[ provider ];
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
