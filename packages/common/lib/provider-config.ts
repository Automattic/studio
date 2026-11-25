import path from 'path';
import {
	getProvider,
	NotConnectedError,
	type ProviderConfigs,
	type ProviderId,
	type ProviderServices,
} from '@studio/providers';
import { readConfig, updateConfig } from './config/store';
import { lockFileAsync, unlockFileAsync } from './lockfile';
import { getConfigDirectory } from './well-known-paths';
import type { Config } from './config/schema';

/**
 * Each provider's config, validated against its descriptor's schema and kept in the `providers`
 * section of the config file. The WordPress.com config is the Studio sign-in.
 */

// The provider's config in `config`, or undefined when it has none or the one it has expired.
export function providerConfigFrom< Id extends ProviderId >(
	config: Config,
	provider: Id
): ProviderConfigs[ Id ] | undefined {
	const { account } = getProvider( provider );
	if ( ! account ) {
		return undefined;
	}
	const parsed = account.configSchema.safeParse( config.providers.configs[ provider ] );
	if ( ! parsed.success ) {
		return undefined;
	}
	const expiresAt = account.expiresAt?.( parsed.data );
	return expiresAt !== undefined && expiresAt <= Date.now() ? undefined : parsed.data;
}

export async function readProviderConfig< Id extends ProviderId >(
	provider: Id
): Promise< ProviderConfigs[ Id ] | undefined > {
	return providerConfigFrom( await readConfig(), provider );
}

// Removes the config when `config` is undefined.
export async function writeProviderConfig< Id extends ProviderId >(
	provider: Id,
	config: ProviderConfigs[ Id ] | undefined
): Promise< void > {
	const valid = config && getProvider( provider ).account?.configSchema.parse( config );
	if ( provider === 'wpcom' && valid && ! ( valid as ProviderConfigs[ 'wpcom' ] ).user ) {
		throw new Error( 'Signing in to Studio needs the WordPress.com account.' );
	}
	await updateConfig( ( { providers } ) => {
		if ( valid === undefined ) {
			delete providers.configs[ provider ];
		} else {
			providers.configs[ provider ] = valid;
		}
		delete providers.remembered[ provider ];
	} );
}

// What the provider keeps from `config` once it rejects it.
function rememberFrom( provider: ProviderId, config: unknown ) {
	const account = getProvider( provider ).account as
		| { remember?: ( config: unknown ) => Record< string, string > }
		| undefined;
	return config ? account?.remember?.( config ) : undefined;
}

async function rememberSignIn( provider: ProviderId, values: Record< string, string > ) {
	await updateConfig( ( { providers } ) => {
		providers.remembered[ provider ] = values;
	} );
}

/**
 * What a provider's sign-in starts from: a stable id for this computer, and what the provider
 * kept from its current config, or from the last one it rejected.
 */
export async function readSignInContext(
	provider: ProviderId
): Promise< { hostId: string; remembered?: Record< string, string > } > {
	const fromConfig = rememberFrom( provider, await readProviderConfig( provider ) );
	const { install, providers } = await readConfig();
	return {
		hostId:
			install.signInHostId ??
			( await updateConfig(
				( config ) => ( config.install.signInHostId ??= crypto.randomUUID() )
			) ),
		remembered: fromConfig ?? providers.remembered[ provider ],
	};
}

/**
 * Runs an operation with the provider's config, forgetting the config when the provider rejects
 * it, so every surface shows the provider as disconnected and offers to connect it again.
 * WordPress.com's is the Studio sign-in, which signing in again replaces.
 */
export async function forgetRejectedConfig< T >(
	provider: ProviderId,
	run: () => Promise< T >
): Promise< T > {
	try {
		return await run();
	} catch ( error ) {
		if ( error instanceof NotConnectedError && provider !== 'wpcom' ) {
			const remembered = rememberFrom( provider, await readProviderConfig( provider ) );
			await writeProviderConfig( provider, undefined );
			if ( remembered ) {
				await rememberSignIn( provider, remembered );
			}
		}
		throw error;
	}
}

// Longer than a renewal's requests take, so a waiting process gets the renewed config.
const REFRESH_LOCK_TIME = 30_000;

// The selected chat provider's stored id, as `normalizeProviderId` reads it.
export async function readSelectedProvider(): Promise< string | undefined > {
	return ( await readConfig() ).providers.selected;
}

export async function writeSelectedProvider( provider: string ): Promise< void > {
	await updateConfig( ( { providers } ) => {
		providers.selected = provider;
	} );
}

/**
 * The provider's config, renewed first when its credential is about to expire. A refresh token
 * works once, so the renewal holds a lock of its own and reads the config inside it: another
 * process may have just renewed it.
 */
export async function readFreshProviderConfig< Config >(
	services: ProviderServices< Config >
): Promise< Config | undefined > {
	const { id } = services;
	const refresh = services.account?.refresh;
	if ( ! refresh ) {
		return ( await readProviderConfig( id ) ) as Config | undefined;
	}
	const lockfilePath = path.join( getConfigDirectory(), `${ id }-refresh.lock` );
	await lockFileAsync( lockfilePath, { wait: REFRESH_LOCK_TIME } );
	try {
		const config = ( await readProviderConfig( id ) ) as Config | undefined;
		const renewed = config && ( await forgetRejectedConfig( id, () => refresh( config ) ) );
		if ( renewed ) {
			await writeProviderConfig( id, renewed as ProviderConfigs[ ProviderId ] );
		}
		return renewed ?? config;
	} finally {
		await unlockFileAsync( lockfilePath );
	}
}
