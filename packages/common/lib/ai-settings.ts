import {
	DEFAULT_PROVIDER_ID,
	getConnectedMethod,
	getProviderDescriptor,
	InvalidCredentialError,
	normalizeAiProviderId,
	PROVIDER_IDS,
	toStoredProviderId,
	type AiProviderId,
	type Provider,
	type ProviderConfigs,
	type ProviderId,
} from '@studio/providers';
import {
	readAiFields,
	readProviderConfig,
	updateAiFields,
	writeProviderConfig,
} from './provider-config';

// A provider's account as the settings UI shows it; never the credential itself.
export interface ProviderAccount {
	connected: boolean;
	summary: string | null;
	// How it connected, for a provider with several methods.
	method?: string;
}

export interface AiSettings {
	// The chat provider new conversations use.
	provider: AiProviderId;
	accounts: Record< ProviderId, ProviderAccount >;
}

/** The saved chat provider, or undefined when none was ever chosen. */
export async function readSelectedAiProvider(): Promise< AiProviderId | undefined > {
	const { aiProvider } = await readAiFields();
	return aiProvider === undefined ? undefined : normalizeAiProviderId( aiProvider );
}

async function readAccount( id: ProviderId ): Promise< ProviderAccount > {
	const config = await readProviderConfig( id );
	const { summarize } = getProviderDescriptor( id ) as {
		summarize?: ( config: unknown ) => string;
	};
	const method = getConnectedMethod( id, config );
	return {
		connected: config !== undefined,
		summary: config && summarize ? summarize( config ) : null,
		...( method ? { method } : {} ),
	};
}

export async function readAiSettings(): Promise< AiSettings > {
	const [ provider, ...accounts ] = await Promise.all( [
		readSelectedAiProvider(),
		...PROVIDER_IDS.map( readAccount ),
	] );
	return {
		provider: provider ?? DEFAULT_PROVIDER_ID,
		accounts: Object.fromEntries(
			PROVIDER_IDS.map( ( id, index ) => [ id, accounts[ index ] ] )
		) as AiSettings[ 'accounts' ],
	};
}

/** Persists the provider without validation — for flows that already ran it. */
export async function persistSelectedAiProvider( provider: AiProviderId ): Promise< void > {
	await updateAiFields( { aiProvider: toStoredProviderId( provider ) } );
}

/**
 * Connects `provider` (from `@studio/providers/services`) with what the user
 * gave: a form's values, with `method` naming the one picked when the provider
 * offers several, or a redirect's parameters. The provider checks them,
 * and its config is stored only when it accepts them.
 */
export async function connectProvider< Config >(
	provider: Provider< Config >,
	input: Record< string, string >
): Promise< AiSettings > {
	const config = await provider.connect( input );
	await writeProviderConfig( provider.descriptor.id, config as ProviderConfigs[ ProviderId ] );
	return readAiSettings();
}

/**
 * Removes the provider's config, after letting it clean up on its side. A
 * selected provider that is no longer connected falls back to WordPress.com.
 */
export async function disconnectProvider< Config >(
	provider: Provider< Config >
): Promise< AiSettings > {
	const { id } = provider.descriptor;
	const config = await readProviderConfig( id );
	if ( config ) {
		// Best-effort: disconnecting offline still forgets the account here.
		await provider.disconnect?.( config as Config ).catch( () => undefined );
	}
	await writeProviderConfig( id, undefined );
	if ( ( await readSelectedAiProvider() ) === id ) {
		await persistSelectedAiProvider( DEFAULT_PROVIDER_ID );
	}
	return readAiSettings();
}

/**
 * Selects the provider for new conversations, once it is connected. Existing
 * sessions keep the provider recorded in their session context.
 */
export async function setAiProvider( provider: AiProviderId ): Promise< AiSettings > {
	if ( ! ( await readProviderConfig( provider ) ) ) {
		throw new InvalidCredentialError(
			`Connect ${ getProviderDescriptor( provider ).label } first.`
		);
	}
	await persistSelectedAiProvider( provider );
	return readAiSettings();
}
