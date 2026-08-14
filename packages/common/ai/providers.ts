import { AI_MODELS, DEFAULT_MODEL, type AiModelFamily, type AiModelId } from './models';
import { isStudioCustomEntryOfType } from './sessions/entry-types';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';

// The literal entries of AI_MODELS, so `id` stays the `AiModelId` union
// instead of widening to `string` for callers that key off it.
type AiProviderModel = ( typeof AI_MODELS )[ number ];

// Persisted in shared.json (`aiProvider`), so treat the list as append-only:
// readers narrow with `isAiProviderId` and fall back to the default on values
// they don't know.
export const AI_PROVIDER_IDS = [ 'wpcom', 'anthropic-api-key' ] as const;

export type AiProviderId = ( typeof AI_PROVIDER_IDS )[ number ];

export const DEFAULT_AI_PROVIDER: AiProviderId = 'wpcom';

// Brand names, not translated.
export const AI_PROVIDER_LABELS: Record< AiProviderId, string > = {
	wpcom: 'WordPress.com',
	'anthropic-api-key': 'Anthropic API',
};

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

export function providerServesModel( provider: AiProviderId, model: AiModelId ): boolean {
	return getAiProviderModels( provider ).some( ( entry ) => entry.id === model );
}

/** The model to fall back to when a provider can't serve the requested one. */
export function getAiProviderDefaultModel( provider: AiProviderId ): AiModelId {
	return getAiProviderModels( provider )[ 0 ]?.id ?? DEFAULT_MODEL;
}

/**
 * The provider a session is pinned to: the most recent `studio.session_context`
 * entry that names a provider wins. Only explicit switches (UI picker, CLI
 * `/provider`) record a provider — the CLI's per-turn entries carry just the
 * model, so pins survive turns run under a fallback provider. Returns
 * undefined when the session was never pinned — callers fall back to the
 * saved global selection.
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
