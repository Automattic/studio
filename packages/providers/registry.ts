import { anthropicProvider } from './anthropic/descriptor';
import { geminiProvider } from './gemini/descriptor';
import { openaiProvider } from './openai/descriptor';
import { spacefastProvider } from './spacefast/descriptor';
import { wpcomProvider } from './wpcom/descriptor';
import { xaiProvider } from './xai/descriptor';
import type {
	AiProviderId,
	Provider,
	ProviderConfigs,
	ProviderId,
	ProviderSite,
	ProviderSitesInfo,
	SitesProviderId,
} from './types';

// The providers that serve AI models, in fallback order: the first ready provider wins.
export const AI_PROVIDER_IDS = [
	'wpcom',
	'anthropic',
	'openai',
	'gemini',
	'xai',
] as const satisfies readonly AiProviderId[];

// The providers with remote sites, in the order the publish panel offers them.
export const SITES_PROVIDER_IDS = [
	'wpcom',
	'spacefast',
] as const satisfies readonly SitesProviderId[];

export const PROVIDER_IDS = [
	...AI_PROVIDER_IDS,
	'spacefast',
] as const satisfies readonly ProviderId[];

export const DEFAULT_PROVIDER_ID: AiProviderId = 'wpcom';

const PROVIDERS: {
	[ Id in ProviderId ]: Provider< ProviderConfigs[ Id ], ProviderSite< Id > >;
} = {
	wpcom: wpcomProvider,
	anthropic: anthropicProvider,
	openai: openaiProvider,
	gemini: geminiProvider,
	xai: xaiProvider,
	spacefast: spacefastProvider,
};

export function getProvider< Id extends ProviderId >(
	id: Id
): Provider< ProviderConfigs[ Id ], ProviderSite< Id > > {
	return PROVIDERS[ id ];
}

// How a provider presents its remote sites, for surfaces that handle any provider's: they only
// ever hand a provider back the sites it gave them.
export function getProviderSites( provider: SitesProviderId ): ProviderSitesInfo {
	return getProvider( provider ).sites as unknown as ProviderSitesInfo;
}

// Builds before the `anthropic` id stored `anthropic-api-key` in shared.json
// and session entries. Older builds fall back to WordPress.com on an id they
// don't know, so writers keep storing the legacy id.
const STORED_PROVIDER_IDS: Record< ProviderId, string > = {
	wpcom: 'wpcom',
	anthropic: 'anthropic-api-key',
	openai: 'openai',
	gemini: 'gemini',
	xai: 'xai',
	spacefast: 'spacefast',
};

// The provider a stored or typed id names, among `ids`.
export function normalizeProviderId< Id extends ProviderId = ProviderId >(
	value: string,
	ids: readonly Id[] = PROVIDER_IDS as readonly ProviderId[] as readonly Id[]
): Id | undefined {
	return ids.find( ( id ) => id === value || STORED_PROVIDER_IDS[ id ] === value );
}

export function toStoredProviderId( id: ProviderId ): string {
	return STORED_PROVIDER_IDS[ id ];
}

// A remote site as the CLI and the agent name it: `<provider>:<site>`, or `<provider>` alone.
// Without a provider it is a WordPress.com site's URL or ID.
export function formatRemoteSite( provider: SitesProviderId, id: string | number ): string {
	return `${ provider }:${ id }`;
}

export function parseRemoteSite( value: string | undefined ): {
	provider: SitesProviderId;
	identifier?: string;
} {
	const [ prefix, ...rest ] = value?.trim().split( ':' ) ?? [];
	const provider = prefix ? normalizeProviderId( prefix, SITES_PROVIDER_IDS ) : undefined;
	return provider
		? { provider, identifier: rest.join( ':' ) || undefined }
		: { provider: 'wpcom', identifier: value?.trim() || undefined };
}
