import { readCliConfigFileRaw } from '@studio/common/lib/cli-config-file';
import {
	lockSharedConfig,
	readSharedConfig,
	saveSharedConfig,
	unlockSharedConfig,
	type SharedConfig,
} from '@studio/common/lib/shared-config';
import {
	AI_PROVIDER_IDS,
	DEFAULT_AI_PROVIDER,
	isAiProviderId,
	type AiProviderId,
	type AiSettings,
} from '@studio/agent/protocol/providers';
import { AI_BACKEND_PROVIDERS, InvalidAiProviderCredentialsError } from './providers';

export { InvalidAiProviderCredentialsError } from './providers';

type AiProviderConfig = Pick< SharedConfig, 'aiProvider' | 'anthropicApiKey' | 'aiProviderCredentials' >;

async function readAiProviderConfig( shared?: SharedConfig ): Promise< AiProviderConfig > {
	const config = shared ?? ( await readSharedConfig() );
	const { aiProvider, anthropicApiKey, aiProviderCredentials } = config;
	if (
		aiProvider === undefined &&
		anthropicApiKey === undefined &&
		aiProviderCredentials === undefined
	) {
		try {
			const legacy = await readCliConfigFileRaw();
			return {
				aiProvider: typeof legacy.aiProvider === 'string' ? legacy.aiProvider : undefined,
				anthropicApiKey:
					typeof legacy.anthropicApiKey === 'string' ? legacy.anthropicApiKey : undefined,
			};
		} catch {
			// A new install has no legacy CLI config.
		}
	}
	return { aiProvider, anthropicApiKey, aiProviderCredentials };
}

function getApiKey( config: AiProviderConfig, provider: AiProviderId ): string | undefined {
	const { auth } = AI_BACKEND_PROVIDERS[ provider ];
	if ( auth.type !== 'api-key' ) return undefined;
	// Keep older Studio versions able to read the existing Anthropic credential.
	return provider === 'anthropic-api-key'
		? config.anthropicApiKey
		: config.aiProviderCredentials?.[ provider ]?.apiKey;
}

function storeApiKey( config: AiProviderConfig, provider: AiProviderId, key: string | null ) {
	const { auth } = AI_BACKEND_PROVIDERS[ provider ];
	if ( auth.type !== 'api-key' ) {
		throw new InvalidAiProviderCredentialsError( 'This provider does not accept an API key.' );
	}
	if ( provider === 'anthropic-api-key' ) {
		config.anthropicApiKey = key ?? undefined;
	} else {
		config.aiProviderCredentials = {
			...config.aiProviderCredentials,
			[ provider ]: key ? { apiKey: key } : null,
		};
	}
}

export async function readAiProviderApiKey(
	provider: AiProviderId
): Promise< string | undefined > {
	return getApiKey( await readAiProviderConfig(), provider );
}

export async function readSelectedAiProvider(): Promise< AiProviderId | undefined > {
	const { aiProvider } = await readAiProviderConfig();
	return aiProvider !== undefined && isAiProviderId( aiProvider ) ? aiProvider : undefined;
}

function previewKey( key: string ): string {
	return key.length <= 20
		? `...${ key.slice( -4 ) }`
		: `${ key.slice( 0, 16 ) }...${ key.slice( -4 ) }`;
}

async function toAiSettings( config: AiProviderConfig ): Promise< AiSettings > {
	const connections = await Promise.all(
		AI_PROVIDER_IDS.map( async ( provider ) => {
			const { auth } = AI_BACKEND_PROVIDERS[ provider ];
			const key = getApiKey( config, provider );
			return [
				provider,
				{
					connected: auth.type === 'account' ? await auth.isConnected() : Boolean( key ),
					apiKeyPreview: key ? previewKey( key ) : null,
				},
			] as const;
		} )
	);
	return {
		provider:
			config.aiProvider !== undefined && isAiProviderId( config.aiProvider )
				? config.aiProvider
				: DEFAULT_AI_PROVIDER,
		connections: Object.fromEntries( connections ) as AiSettings[ 'connections' ],
	};
}

export async function readAiSettings(): Promise< AiSettings > {
	return toAiSettings( await readAiProviderConfig() );
}

export function getAiSettingsChange( previous: AiSettings, next: AiSettings ) {
	const unchanged =
		previous.provider === next.provider &&
		AI_PROVIDER_IDS.every(
			( id ) =>
				previous.connections[ id ].connected === next.connections[ id ].connected &&
				previous.connections[ id ].apiKeyPreview === next.connections[ id ].apiKeyPreview
		);
	if ( unchanged ) {
		return undefined;
	}
	return {
		provider: next.provider,
		// Preserve the historical analytics property without sending credential previews.
		has_anthropic_api_key: next.connections[ 'anthropic-api-key' ].connected,
		surface: 'settings',
	};
}

async function updateAiProviderConfig(
	update: ( config: AiProviderConfig ) => void
): Promise< AiSettings > {
	let config: AiProviderConfig;
	try {
		await lockSharedConfig();
		const shared = await readSharedConfig();
		config = await readAiProviderConfig( shared );
		update( config );
		await saveSharedConfig( { ...shared, ...config } );
	} finally {
		await unlockSharedConfig();
	}
	return toAiSettings( config );
}

async function validateApiKey( provider: AiProviderId, key: string ): Promise< void > {
	const { auth } = AI_BACKEND_PROVIDERS[ provider ];
	if ( auth.type !== 'api-key' ) {
		throw new InvalidAiProviderCredentialsError( 'This provider does not accept an API key.' );
	}
	const validation = await auth.validate( key );
	if ( validation.status === 'invalid' ) {
		throw new InvalidAiProviderCredentialsError( validation.message );
	}
}

export async function saveAiProviderApiKey(
	provider: AiProviderId,
	key: string | null
): Promise< AiSettings > {
	if ( AI_BACKEND_PROVIDERS[ provider ].auth.type !== 'api-key' ) {
		throw new InvalidAiProviderCredentialsError( 'This provider does not accept an API key.' );
	}
	const trimmed = key?.trim();
	if ( trimmed ) {
		await validateApiKey( provider, trimmed );
	}
	return updateAiProviderConfig( ( config ) => {
		storeApiKey( config, provider, trimmed || null );
		if ( ! trimmed && ( config.aiProvider === provider || config.aiProvider === undefined ) ) {
			config.aiProvider = DEFAULT_AI_PROVIDER;
		}
	} );
}

export async function setAiProvider( provider: AiProviderId ): Promise< AiSettings > {
	const { auth } = AI_BACKEND_PROVIDERS[ provider ];
	if ( auth.type === 'api-key' ) {
		const key = await readAiProviderApiKey( provider );
		if ( ! key ) {
			throw new InvalidAiProviderCredentialsError( auth.getMissingKeyMessage() );
		}
		await validateApiKey( provider, key );
	}
	return updateAiProviderConfig( ( config ) => {
		config.aiProvider = provider;
	} );
}

/** For connection flows that already validated the selection or key. */
export async function persistSelectedAiProvider( provider: AiProviderId ): Promise< void > {
	await updateAiProviderConfig( ( config ) => {
		config.aiProvider = provider;
	} );
}

export async function persistAiProviderApiKey(
	provider: AiProviderId,
	key: string
): Promise< void > {
	await updateAiProviderConfig( ( config ) => {
		storeApiKey( config, provider, key );
	} );
}
