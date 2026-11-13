import {
	AI_PROVIDER_IDS,
	ConnectError,
	DEFAULT_PROVIDER_ID,
	getConnectMethod,
	getProvider,
	normalizeProviderId,
	PROVIDER_IDS,
	toStoredProviderId,
	type AccountDetails,
	type AiProviderId,
	type ProviderConfigs,
	type ProviderId,
	type ProviderServices,
} from '@studio/providers';
import {
	readAiFields,
	readProviderConfig,
	updateAiFields,
	writeProviderConfig,
} from './provider-config';
import { receiveRedirect } from './provider-connect';

// A provider's account as surfaces show it; never the credential itself.
export type ProviderAccount = { connected: false } | ( { connected: true } & AccountDetails );

export interface AiSettings {
	// The chat provider new conversations use.
	provider: AiProviderId;
	accounts: Record< ProviderId, ProviderAccount >;
}

/** The saved chat provider, or undefined when none was ever chosen. */
export async function readSelectedAiProvider(): Promise< AiProviderId | undefined > {
	const { aiProvider } = await readAiFields();
	return aiProvider === undefined ? undefined : normalizeProviderId( aiProvider, AI_PROVIDER_IDS );
}

// What surfaces show of the provider's account, from its config.
export function describeAccount( id: ProviderId, config: unknown ): ProviderAccount {
	const { describe } = getProvider( id ).account as {
		describe: ( config: unknown ) => AccountDetails;
	};
	return config === undefined ? { connected: false } : { connected: true, ...describe( config ) };
}

async function readAccount( id: ProviderId ): Promise< ProviderAccount > {
	return describeAccount( id, await readProviderConfig( id ) );
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
 * Connects the provider (from `@studio/providers/services`) with `method` and what the user
 * gave: a form's values, or the handoff of the connection `startProviderConnect` started, which a
 * loopback sign-in completes with its redirect. The provider checks them, and its config is
 * stored only when it accepts them.
 */
export async function connectProvider< Config >(
	services: ProviderServices< Config >,
	method: string,
	input: Record< string, string >,
	options: { pasteUrl?: () => Promise< string > } = {}
): Promise< AiSettings > {
	const { id } = services;
	const config = await services.account.connect(
		method,
		getConnectMethod( id, method ).kind === 'loopback'
			? await receiveRedirect( id, input, options.pasteUrl )
			: input
	);
	await writeProviderConfig( id, config as ProviderConfigs[ ProviderId ] );
	return readAiSettings();
}

/**
 * Removes the provider's config, after letting it clean up on its side. A
 * selected provider that is no longer connected falls back to WordPress.com.
 */
export async function disconnectProvider< Config >(
	services: ProviderServices< Config >
): Promise< AiSettings > {
	const { id } = services;
	const config = await readProviderConfig( id );
	if ( config ) {
		// Best-effort: disconnecting offline still forgets the account here.
		await services.account.disconnect?.( config as Config ).catch( () => undefined );
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
		throw new ConnectError( `Connect ${ getProvider( provider ).label } first.` );
	}
	await persistSelectedAiProvider( provider );
	return readAiSettings();
}
