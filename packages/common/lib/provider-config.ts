import path from 'path';
import {
	getProviderDescriptor,
	ProviderNotReadyError,
	type Provider,
	type ProviderConfigs,
	type ProviderId,
} from '@studio/providers';
import { readCliConfigFileRaw } from './cli-config-file';
import { lockFileAsync, unlockFileAsync } from './lockfile';
import {
	lockSharedConfig,
	readAuthToken,
	readSharedConfig,
	saveSharedConfig,
	unlockSharedConfig,
	updateSharedConfig,
} from './shared-config';
import { getConfigDirectory } from './well-known-paths';

/**
 * Each provider's config, validated against its descriptor's schema. The first
 * providers' map onto the shared.json fields builds of every version read: the
 * WordPress.com config is the Studio sign-in (`authToken`), the Anthropic one
 * the saved key (`anthropicApiKey`). Later providers, and Anthropic's
 * subscription token, keep theirs in `providerConfigs`.
 */

interface AiFields {
	aiProvider?: string;
	anthropicApiKey?: string;
}

/**
 * Earlier builds stored the AI fields in the CLI-owned `cli.json`; reads fall
 * back to it until either field is in shared.json, writes always target
 * shared.json.
 */
export async function readAiFields(): Promise< AiFields > {
	const { aiProvider, anthropicApiKey } = await readSharedConfig();
	if ( aiProvider !== undefined || anthropicApiKey !== undefined ) {
		return { aiProvider, anthropicApiKey };
	}
	try {
		const legacy = await readCliConfigFileRaw();
		return {
			aiProvider: typeof legacy.aiProvider === 'string' ? legacy.aiProvider : undefined,
			anthropicApiKey:
				typeof legacy.anthropicApiKey === 'string' ? legacy.anthropicApiKey : undefined,
		};
	} catch {
		return {};
	}
}

// Carries the legacy cli.json values over on first write so a partial update
// doesn't orphan the other field there.
export async function updateAiFields( update: AiFields ): Promise< AiFields > {
	const fields = { ...( await readAiFields() ), ...update };
	await updateSharedConfig( fields );
	return fields;
}

type ConfigStore< Config > = {
	read(): Promise< unknown >;
	write( config: Config | undefined ): Promise< void >;
};

const anthropicSection = providerConfigStore( 'anthropic' );

// The WordPress.com config is the Studio sign-in, so builds of every version
// share it.
const STORES: { [ Id in ProviderId ]: ConfigStore< ProviderConfigs[ Id ] > } = {
	wpcom: {
		read: async () => {
			const token = await readAuthToken();
			return (
				token && {
					token: token.accessToken,
					expiresAt: token.expirationTime,
					user: { id: token.id, email: token.email, displayName: token.displayName },
				}
			);
		},
		write: async ( config ) => {
			if ( config && ! config.user ) {
				throw new Error( 'Signing in to Studio needs the WordPress.com account.' );
			}
			const expirationTime = config?.expiresAt ?? Date.now();
			await updateSharedConfig( {
				authToken: config?.user && {
					accessToken: config.token,
					expirationTime,
					expiresIn: Math.round( ( expirationTime - Date.now() ) / 1000 ),
					...config.user,
				},
			} );
		},
	},
	// Only an API key stays where older builds read it.
	anthropic: {
		read: async () => {
			const config = await anthropicSection.read();
			if ( config ) {
				return config;
			}
			const { anthropicApiKey } = await readAiFields();
			return anthropicApiKey && { method: 'api-key', apiKey: anthropicApiKey };
		},
		write: async ( config ) => {
			await anthropicSection.write( config?.method === 'api-key' ? undefined : config );
			await updateAiFields( {
				anthropicApiKey: config?.method === 'api-key' ? config.apiKey : undefined,
			} );
		},
	},
	openai: providerConfigStore( 'openai' ),
	spacefast: providerConfigStore( 'spacefast' ),
};

// A config whose `expiresAt` has passed no longer works, so the provider is no longer connected.
function hasExpired( config: unknown ): boolean {
	const expiresAt = ( config as { expiresAt?: unknown } | undefined )?.expiresAt;
	return (
		( typeof expiresAt === 'string' || typeof expiresAt === 'number' ) &&
		new Date( expiresAt ).getTime() <= Date.now()
	);
}

// A provider that came after the fields above keeps its config in `providerConfigs`.
function providerConfigStore( id: ProviderId ): ConfigStore< unknown > {
	return {
		read: async () => {
			const config = ( await readSharedConfig() ).providerConfigs?.[ id ];
			return hasExpired( config ) ? undefined : config;
		},
		write: async ( config ) => {
			try {
				await lockSharedConfig();
				const shared = await readSharedConfig();
				const { [ id ]: _removed, ...others } = shared.providerConfigs ?? {};
				shared.providerConfigs = config === undefined ? others : { ...others, [ id ]: config };
				if ( ! Object.keys( shared.providerConfigs ).length ) {
					delete shared.providerConfigs;
				}
				await saveSharedConfig( shared );
			} finally {
				await unlockSharedConfig();
			}
		},
	};
}

export async function readProviderConfig< Id extends ProviderId >(
	provider: Id
): Promise< ProviderConfigs[ Id ] | undefined > {
	const parsed = getProviderDescriptor( provider ).configSchema.safeParse(
		await STORES[ provider ].read()
	);
	return parsed.success ? parsed.data : undefined;
}

// Removes the config when `config` is undefined.
export async function writeProviderConfig< Id extends ProviderId >(
	provider: Id,
	config: ProviderConfigs[ Id ] | undefined
): Promise< void > {
	const valid = config && getProviderDescriptor( provider ).configSchema.parse( config );
	await ( STORES[ provider ] as ConfigStore< ProviderConfigs[ Id ] > ).write( valid );
	if ( ( await readSharedConfig() ).rememberedSignIns?.[ provider ] ) {
		await rememberSignIn( provider, undefined );
	}
}

// What the provider keeps from `config` once it rejects it.
function rememberFrom( provider: ProviderId, config: unknown ) {
	const { remember } = getProviderDescriptor( provider ) as {
		remember?: ( config: unknown ) => Record< string, string >;
	};
	return config ? remember?.( config ) : undefined;
}

async function rememberSignIn(
	provider: ProviderId,
	values: Record< string, string > | undefined
): Promise< void > {
	try {
		await lockSharedConfig();
		const shared = await readSharedConfig();
		const { [ provider ]: _removed, ...others } = shared.rememberedSignIns ?? {};
		shared.rememberedSignIns = values ? { ...others, [ provider ]: values } : others;
		await saveSharedConfig( shared );
	} finally {
		await unlockSharedConfig();
	}
}

/**
 * What a provider's sign-in starts from: a stable id for this computer, and what the provider
 * kept from its current config, or from the last one it rejected.
 */
export async function readSignInContext(
	provider: ProviderId
): Promise< { hostId: string; remembered?: Record< string, string > } > {
	const fromConfig = rememberFrom( provider, await readProviderConfig( provider ) );
	try {
		await lockSharedConfig();
		const shared = await readSharedConfig();
		if ( ! shared.signInHostId ) {
			shared.signInHostId = crypto.randomUUID();
			await saveSharedConfig( shared );
		}
		return {
			hostId: shared.signInHostId,
			remembered: fromConfig ?? shared.rememberedSignIns?.[ provider ],
		};
	} finally {
		await unlockSharedConfig();
	}
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
		if ( error instanceof ProviderNotReadyError && provider !== 'wpcom' ) {
			const remembered = rememberFrom( provider, await readProviderConfig( provider ) );
			await writeProviderConfig( provider, undefined );
			if ( remembered ) {
				await rememberSignIn( provider, remembered );
			}
		}
		throw error;
	}
}

// Longer than a renewal's requests take, so a waiting process never takes over a live lock.
const REFRESH_LOCK_TIME = 30_000;

/**
 * The provider's config, renewed first when its credential is about to expire. A refresh token
 * works once, so the renewal holds a lock of its own and reads the config inside it: another
 * process may have just renewed it.
 */
export async function readFreshProviderConfig< Config >(
	provider: Provider< Config >
): Promise< Config | undefined > {
	const { id } = provider.descriptor;
	const { refresh } = provider;
	if ( ! refresh ) {
		return ( await readProviderConfig( id ) ) as Config | undefined;
	}
	const lockfilePath = path.join( getConfigDirectory(), `${ id }-refresh.lock` );
	await lockFileAsync( lockfilePath, { wait: REFRESH_LOCK_TIME, stale: REFRESH_LOCK_TIME } );
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
