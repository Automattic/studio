import { anthropicProvider } from './anthropic/descriptor';
import { geminiProvider } from './gemini/descriptor';
import { githubCopilotProvider } from './github-copilot/descriptor';
import { openaiProvider } from './openai/descriptor';
import { spacefastProvider } from './spacefast/descriptor';
import { wpcomProvider } from './wpcom/descriptor';
import type { ConfigOf, ModelIdOf, Provider, ProviderSitesInfo, RemoteSite, SiteOf } from './types';

/**
 * Every provider, in order: a new provider is appended. Studio lists providers in this order, and
 * where it picks the first connected or ready provider, or the first provider that lists a model,
 * the earlier one wins.
 */
const PROVIDERS = [
	wpcomProvider,
	anthropicProvider,
	openaiProvider,
	geminiProvider,
	githubCopilotProvider,
	spacefastProvider,
] as const;

type Registered = ( typeof PROVIDERS )[ number ];

export type ProviderId = Registered[ 'id' ];

// The providers that serve AI models.
export type AiProviderId = Extract< Registered, { ai: object } >[ 'id' ];

export type SitesProviderId = Extract< Registered, { sites: object } >[ 'id' ];

// What Studio stores for each provider.
export type ProviderConfigs = {
	[ Descriptor in Registered as Descriptor[ 'id' ] ]: ConfigOf< Descriptor >;
};

// The remote sites of each provider that offers them.
export type ProviderSites = {
	[ Descriptor in Extract<
		Registered,
		{ sites: object }
	> as Descriptor[ 'id' ] ]: SiteOf< Descriptor >;
};

// Every registered provider's model ids.
export type AiModelId = ModelIdOf< Registered >;

// A provider's remote site, or the base every remote site shares.
export type ProviderSite< Id extends ProviderId > = Id extends SitesProviderId
	? ProviderSites[ Id ]
	: RemoteSite;

// Each provider typed as surfaces read any provider.
const DESCRIPTORS = PROVIDERS as readonly Provider[];

export const PROVIDER_IDS = DESCRIPTORS.map( ( { id } ) => id ) as readonly ProviderId[];

// The providers that serve AI models, in fallback order: the first ready provider wins.
export const AI_PROVIDER_IDS = DESCRIPTORS.filter( ( { ai } ) => ai ).map(
	( { id } ) => id
) as readonly AiProviderId[];

// The providers with remote sites, in the order the publish panel offers them.
export const SITES_PROVIDER_IDS = DESCRIPTORS.filter( ( { sites } ) => sites ).map(
	( { id } ) => id
) as readonly SitesProviderId[];

export const DEFAULT_PROVIDER_ID: AiProviderId = 'wpcom';

export function getProvider< Id extends ProviderId >(
	id: Id
): Provider< ProviderConfigs[ Id ], ProviderSite< Id > > {
	return DESCRIPTORS.find( ( descriptor ) => descriptor.id === id ) as unknown as Provider<
		ProviderConfigs[ Id ],
		ProviderSite< Id >
	>;
}

// How a provider presents its remote sites, for surfaces that handle any provider's: they only
// ever hand a provider back the sites it gave them.
export function getProviderSites( provider: SitesProviderId ): ProviderSitesInfo {
	return getProvider( provider ).sites as unknown as ProviderSitesInfo;
}

// Builds before the `anthropic` id stored `anthropic-api-key` in shared.json
// and session entries. Older builds fall back to WordPress.com on an id they
// don't know, so writers keep storing the legacy id. Every other provider is
// stored under its id.
const STORED_PROVIDER_IDS: Partial< Record< ProviderId, string > > = {
	anthropic: 'anthropic-api-key',
};

// The provider a stored or typed id names, among `ids`.
export function normalizeProviderId< Id extends ProviderId = ProviderId >(
	value: string,
	ids: readonly Id[] = PROVIDER_IDS as readonly Id[]
): Id | undefined {
	return ids.find( ( id ) => id === value || STORED_PROVIDER_IDS[ id ] === value );
}

export function toStoredProviderId( id: ProviderId ): string {
	return STORED_PROVIDER_IDS[ id ] ?? id;
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
