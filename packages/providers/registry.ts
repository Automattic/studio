import { anthropicProvider } from './anthropic/descriptor';
import { geminiProvider } from './gemini/descriptor';
import { githubCopilotProvider } from './github-copilot/descriptor';
import { localLlmProvider } from './local-llm/descriptor';
import { metaProvider } from './meta/descriptor';
import { openaiProvider } from './openai/descriptor';
import { openrouterProvider } from './openrouter/descriptor';
import { spacefastProvider } from './spacefast/descriptor';
import { sshProvider } from './ssh/descriptor';
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

// Every provider, in order: the order of every list below. AI providers fall back in it (the
// first ready one wins), and the publish panel offers hosting providers in it.
const PROVIDERS: {
	[ Id in ProviderId ]: Provider< ProviderConfigs[ Id ], ProviderSite< Id > >;
} = {
	wpcom: wpcomProvider,
	anthropic: anthropicProvider,
	openai: openaiProvider,
	gemini: geminiProvider,
	'github-copilot': githubCopilotProvider,
	meta: metaProvider,
	xai: xaiProvider,
	openrouter: openrouterProvider,
	'local-llm': localLlmProvider,
	spacefast: spacefastProvider,
	ssh: sshProvider,
};

type Ids< Id > = readonly [ Id, ...Id[] ];

export const PROVIDER_IDS = Object.keys( PROVIDERS ) as unknown as Ids< ProviderId >;

export const AI_PROVIDER_IDS = PROVIDER_IDS.filter(
	( id ) => PROVIDERS[ id ].ai
) as unknown as Ids< AiProviderId >;

export const SITES_PROVIDER_IDS = PROVIDER_IDS.filter(
	( id ) => PROVIDERS[ id ].sites
) as unknown as Ids< SitesProviderId >;

export const DEFAULT_PROVIDER_ID: AiProviderId = 'wpcom';

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

// Whether the provider generates images with `config`.
export function generatesImages( id: ProviderId, config: unknown ): boolean {
	const { ai } = getProvider( id ) as { ai?: { generatesImages?( config: unknown ): boolean } };
	return ai?.generatesImages?.( config ) ?? false;
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
	ids: readonly Id[] = PROVIDER_IDS as readonly ProviderId[] as readonly Id[]
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
