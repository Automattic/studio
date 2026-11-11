import { anthropicDescriptor } from './anthropic/descriptor';
import { spacefastDescriptor } from './spacefast/descriptor';
import { wpcomDescriptor } from './wpcom/descriptor';
import type { AiProviderId, ProviderConfigs, ProviderDescriptor, ProviderId } from './types';

// The providers that serve AI models, in fallback order: the first ready provider wins.
export const AI_PROVIDER_IDS = [ 'wpcom', 'anthropic' ] as const satisfies readonly AiProviderId[];

export const PROVIDER_IDS = [
	...AI_PROVIDER_IDS,
	'spacefast',
] as const satisfies readonly ProviderId[];

export const DEFAULT_PROVIDER_ID: AiProviderId = 'wpcom';

const DESCRIPTORS: { [ Id in ProviderId ]: ProviderDescriptor< ProviderConfigs[ Id ] > } = {
	wpcom: wpcomDescriptor,
	anthropic: anthropicDescriptor,
	spacefast: spacefastDescriptor,
};

export function getProviderDescriptor< Id extends ProviderId >(
	id: Id
): ProviderDescriptor< ProviderConfigs[ Id ] > {
	return DESCRIPTORS[ id ];
}

// Builds before the `anthropic` id stored `anthropic-api-key` in shared.json
// and session entries. Older builds fall back to WordPress.com on an id they
// don't know, so writers keep storing the legacy id.
const STORED_PROVIDER_IDS: Record< ProviderId, string > = {
	wpcom: 'wpcom',
	anthropic: 'anthropic-api-key',
	spacefast: 'spacefast',
};

export function normalizeProviderId( value: string ): ProviderId | undefined {
	return PROVIDER_IDS.find( ( id ) => id === value || STORED_PROVIDER_IDS[ id ] === value );
}

function isAiProviderId( id: ProviderId ): id is AiProviderId {
	return ( AI_PROVIDER_IDS as readonly ProviderId[] ).includes( id );
}

export function normalizeAiProviderId( value: string ): AiProviderId | undefined {
	const id = normalizeProviderId( value );
	return id && isAiProviderId( id ) ? id : undefined;
}

export function toStoredProviderId( id: ProviderId ): string {
	return STORED_PROVIDER_IDS[ id ];
}
