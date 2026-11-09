import { resolveSessionModel, type AiModel, type AiModelId } from '@studio/agent/protocol/models';
import { AI_PROVIDERS, type AiProviderDescriptor } from '@studio/agent/protocol/provider-catalog';
import { isStudioCustomEntryOfType } from '@studio/agent/protocol/sessions/entry-types';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';

// Persisted in shared.json (`aiProvider`), so treat the list as append-only:
// readers narrow with `isAiProviderId` and fall back to the default on values
// they don't know.
export type AiProviderId = ( typeof AI_PROVIDERS )[ number ][ 'id' ];
export const AI_PROVIDER_IDS = AI_PROVIDERS.map( ( provider ) => provider.id );

export const DEFAULT_AI_PROVIDER: AiProviderId = 'wpcom';

export const AI_PROVIDER_LABELS = Object.fromEntries(
	AI_PROVIDERS.map( ( provider ) => [ provider.id, provider.label ] )
) as Record< AiProviderId, string >;

const PROVIDER_BY_ID: ReadonlyMap< AiProviderId, AiProviderDescriptor > = new Map(
	AI_PROVIDERS.map( ( provider ) => [ provider.id, provider ] )
);

export function getAiProvider( provider: AiProviderId ): AiProviderDescriptor {
	return PROVIDER_BY_ID.get( provider )!;
}

export function isAiProviderId( value: string ): value is AiProviderId {
	return ( AI_PROVIDER_IDS as readonly string[] ).includes( value );
}

export function getAiProviderModels(
	provider: AiProviderId
): readonly ( AiModel & { id: AiModelId } )[] {
	return getAiProvider( provider ).models as readonly ( AiModel & { id: AiModelId } )[];
}

export function providerServesModel( provider: AiProviderId, model: AiModelId ): boolean {
	return getAiProviderModels( provider ).some( ( entry ) => entry.id === model );
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
	const definition = getAiProvider( provider );
	return (
		options?.canUsePaidModels && definition.paidDefaultModel
			? definition.paidDefaultModel
			: definition.defaultModel
	) as AiModelId;
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
 * then the saved global selection. A missing credential falls back to the
 * default; account-backed providers retain their existing login flow.
 */
export function getEffectiveSessionProvider(
	entries: SessionEntry[],
	settings?: AiSettings | null
): AiProviderId {
	if ( ! settings ) {
		return DEFAULT_AI_PROVIDER;
	}
	const provider = resolveSessionProvider( entries ) ?? settings.provider;
	return getAiProvider( provider ).connection.type === 'account' ||
		settings.connections[ provider ].connected
		? provider
		: DEFAULT_AI_PROVIDER;
}

export interface AiProviderConnection {
	connected: boolean;
	apiKeyPreview: string | null;
}

/** Public connection summaries never contain usable credentials. */
export interface AiSettings {
	provider: AiProviderId;
	connections: Record< AiProviderId, AiProviderConnection >;
}
