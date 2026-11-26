import {
	AI_PROVIDER_IDS,
	ConnectError,
	DEFAULT_PROVIDER_ID,
	generatesImages,
	getConnectMethod,
	getProvider,
	normalizeProviderId,
	PROVIDER_IDS,
	toStoredProviderId,
	type AccountDetails,
	type AiProviderId,
	type CatalogModel,
	type ProviderConfigs,
	type ProviderId,
	type ProviderServices,
} from '@studio/providers';
import { readConfig, updateConfig } from './config/store';
import {
	readFreshProviderConfig,
	readProviderConfig,
	readSelectedProvider,
	writeProviderConfig,
	writeSelectedProvider,
} from './provider-config';
import { receiveRedirect } from './provider-connect';

// A provider's account as surfaces show it; never the credential itself.
export type ProviderAccount = { connected: false } | ( { connected: true } & AccountDetails );

export interface AiSettings {
	// The chat provider new conversations use.
	provider: AiProviderId;
	accounts: Record< ProviderId, ProviderAccount >;
	// The connected providers that generate images, and the one picked; null picks automatically.
	imageProviders: AiProviderId[];
	imageProvider: AiProviderId | null;
}

/** The saved chat provider, or undefined when none was ever chosen. */
export async function readSelectedAiProvider(): Promise< AiProviderId | undefined > {
	const aiProvider = await readSelectedProvider();
	return aiProvider === undefined ? undefined : normalizeProviderId( aiProvider, AI_PROVIDER_IDS );
}

// What surfaces show of the provider's account, from its config.
export function describeAccount( id: ProviderId, config: unknown ): ProviderAccount {
	const account = getProvider( id ).account as
		| { describe: ( config: unknown ) => AccountDetails }
		| undefined;
	return config === undefined || ! account
		? { connected: false }
		: { connected: true, ...account.describe( config ) };
}

/** The provider picked for image generation, or undefined to pick it automatically. */
export async function readSelectedImageProvider(): Promise< AiProviderId | undefined > {
	const { selectedImage } = ( await readConfig() ).providers;
	return selectedImage === undefined
		? undefined
		: normalizeProviderId( selectedImage, AI_PROVIDER_IDS );
}

export async function readAiSettings(): Promise< AiSettings > {
	const [ provider, imageProvider, configs ] = await Promise.all( [
		readSelectedAiProvider(),
		readSelectedImageProvider(),
		Promise.all( PROVIDER_IDS.map( ( id ) => readProviderConfig( id ) ) ),
	] );
	const imageProviders = AI_PROVIDER_IDS.filter( ( id ) => {
		const config = configs[ PROVIDER_IDS.indexOf( id ) ];
		return config !== undefined && generatesImages( id, config );
	} );
	return {
		provider: provider ?? DEFAULT_PROVIDER_ID,
		accounts: Object.fromEntries(
			PROVIDER_IDS.map( ( id, index ) => [ id, describeAccount( id, configs[ index ] ) ] )
		) as AiSettings[ 'accounts' ],
		imageProviders,
		// A picked provider that can no longer generate images falls back to automatic.
		imageProvider: imageProvider && imageProviders.includes( imageProvider ) ? imageProvider : null,
	};
}

/** Persists the provider without validation — for flows that already ran it. */
export async function persistSelectedAiProvider( provider: AiProviderId ): Promise< void > {
	await writeSelectedProvider( toStoredProviderId( provider ) );
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
	const { id, account } = services;
	if ( ! account ) {
		throw new Error( `${ id } has no account to connect` );
	}
	const config = await account.connect(
		method,
		getConnectMethod( id, method ).kind === 'loopback'
			? await receiveRedirect( id, input, options.pasteUrl )
			: input
	);
	await writeProviderConfig( id, config as ProviderConfigs[ ProviderId ] );
	// A chat provider becomes the default only when the current default can't be used, so
	// connecting another provider never takes over from a connected WordPress.com.
	const aiProvider = normalizeProviderId( id, AI_PROVIDER_IDS );
	const selected = ( await readSelectedAiProvider() ) ?? DEFAULT_PROVIDER_ID;
	if ( aiProvider && aiProvider !== selected && ! ( await readProviderConfig( selected ) ) ) {
		await persistSelectedAiProvider( aiProvider );
	}
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
		await services.account?.disconnect?.( config as never ).catch( () => undefined );
	}
	await writeProviderConfig( id, undefined );
	if ( ( await readSelectedAiProvider() ) === id ) {
		await persistSelectedAiProvider( DEFAULT_PROVIDER_ID );
	}
	return readAiSettings();
}

// The catalog the account's owner picks the provider's models from (`Provider.ai.catalog`).
export async function listProviderModels< Config >(
	services: ProviderServices< Config >
): Promise< CatalogModel[] > {
	const listModels = services.ai?.listModels;
	if ( ! listModels ) {
		throw new Error( `${ getProvider( services.id ).label } has no models to pick from.` );
	}
	return listModels( await readFreshProviderConfig( services ) );
}

// Offers these models of the provider's catalog, as `listProviderModels` returned them.
export async function selectProviderModels< Config >(
	services: ProviderServices< Config >,
	models: CatalogModel[]
): Promise< AiSettings > {
	const { id } = services;
	const config = await readFreshProviderConfig( services );
	const selectModels = services.ai?.selectModels;
	if ( ! config || ! selectModels ) {
		throw new ConnectError( `Connect ${ getProvider( id ).label } first.` );
	}
	await writeProviderConfig(
		id,
		( await selectModels( config, models ) ) as ProviderConfigs[ ProviderId ]
	);
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

/** Picks the provider that generates images, or null to pick it automatically. */
export async function setImageProvider( provider: AiProviderId | null ): Promise< AiSettings > {
	if ( provider && ! ( await readAiSettings() ).imageProviders.includes( provider ) ) {
		throw new ConnectError( `${ getProvider( provider ).label } can't generate images here.` );
	}
	await updateConfig( ( { providers } ) => {
		providers.selectedImage = provider ? toStoredProviderId( provider ) : undefined;
	} );
	return readAiSettings();
}
