import {
	AI_PROVIDER_PRIORITY,
	DEFAULT_AI_PROVIDER,
	getAiProviderDefinition,
	type AiProviderId,
} from 'cli/ai/providers';
import { getAiProvider, saveAiProvider } from 'cli/lib/appdata';

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
	const savedProvider = await getAiProvider();
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
	await saveAiProvider( provider );
}

export async function prepareAiProvider( provider: AiProviderId ): Promise< void > {
	await getAiProviderDefinition( provider ).prepare();
}

export async function resolveAiEnvironment(
	provider: AiProviderId
): Promise< Record< string, string > > {
	return getAiProviderDefinition( provider ).resolveEnv();
}
