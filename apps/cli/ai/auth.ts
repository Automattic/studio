import {
	AI_PROVIDER_PRIORITY,
	DEFAULT_AI_PROVIDER,
	getAiProviderDefinition,
	hasInlineWpcomAuth,
	type AiProviderId,
	type ResolveAiEnvironmentOptions,
} from 'cli/ai/providers';
import { readCliConfig, updateCliConfigWithPartial } from 'cli/lib/cli-config/core';

async function getPreferredReadyProvider(
	exclude?: AiProviderId
): Promise< AiProviderId | undefined > {
	for ( const provider of AI_PROVIDER_PRIORITY ) {
		if ( provider === exclude ) {
			continue;
		}

		const definition = getAiProviderDefinition( provider );
		if ( ( await definition.isVisible() ) && ( await definition.isReady() ) ) {
			return provider;
		}
	}

	return undefined;
}

export async function getAvailableAiProviders(): Promise< AiProviderId[] > {
	const providers: AiProviderId[] = [];
	for ( const provider of AI_PROVIDER_PRIORITY ) {
		if ( await getAiProviderDefinition( provider ).isVisible() ) {
			providers.push( provider );
		}
	}
	return providers;
}

export async function isAiProviderReady( provider: AiProviderId ): Promise< boolean > {
	return getAiProviderDefinition( provider ).isReady();
}

export async function resolveUnavailableAiProvider(
	provider: AiProviderId
): Promise< AiProviderId | undefined > {
	const definition = getAiProviderDefinition( provider );
	if ( ( await definition.isReady() ) || ! definition.autoFallbackWhenUnavailable ) {
		return undefined;
	}

	return getPreferredReadyProvider( provider );
}

export async function resolveInitialAiProvider(): Promise< AiProviderId > {
	if ( hasInlineWpcomAuth() ) {
		return 'wpcom';
	}

	const { aiProvider: savedProvider } = await readCliConfig();
	if ( savedProvider ) {
		const definition = getAiProviderDefinition( savedProvider );
		if (
			( await definition.isVisible() ) &&
			( ( await definition.isReady() ) || ! definition.autoFallbackWhenUnavailable )
		) {
			return savedProvider;
		}

		const fallbackProvider = await getPreferredReadyProvider( savedProvider );
		if ( fallbackProvider ) {
			return fallbackProvider;
		}

		if ( await definition.isVisible() ) {
			return savedProvider;
		}
	}

	return ( await getPreferredReadyProvider() ) ?? DEFAULT_AI_PROVIDER;
}

export async function saveSelectedAiProvider( provider: AiProviderId ): Promise< void > {
	await updateCliConfigWithPartial( { aiProvider: provider } );
}

export async function prepareAiProvider(
	provider: AiProviderId,
	options?: { force?: boolean }
): Promise< void > {
	await getAiProviderDefinition( provider ).prepare( options );
}

export async function resolveAiEnvironment(
	provider: AiProviderId,
	options?: ResolveAiEnvironmentOptions
): Promise< Record< string, string > > {
	return getAiProviderDefinition( provider ).resolveEnv( options );
}
