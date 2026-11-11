import { anthropicDescriptor } from './anthropic/descriptor';
import { geminiDescriptor } from './gemini/descriptor';
import { wpcomDescriptor } from './wpcom/descriptor';
import type { ProviderConfigs, ProviderDescriptor, ProviderId } from './types';

// Also the fallback order: the first ready provider wins.
export const PROVIDER_IDS = [
	'wpcom',
	'anthropic',
	'gemini',
] as const satisfies readonly ProviderId[];

export const DEFAULT_PROVIDER_ID: ProviderId = 'wpcom';

const DESCRIPTORS: { [ Id in ProviderId ]: ProviderDescriptor< ProviderConfigs[ Id ] > } = {
	wpcom: wpcomDescriptor,
	anthropic: anthropicDescriptor,
	gemini: geminiDescriptor,
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
	gemini: 'gemini',
};

export function normalizeProviderId( value: string ): ProviderId | undefined {
	return PROVIDER_IDS.find( ( id ) => id === value || STORED_PROVIDER_IDS[ id ] === value );
}

export function toStoredProviderId( id: ProviderId ): string {
	return STORED_PROVIDER_IDS[ id ];
}
