import { getProviderDescriptor, type ProviderConfigs, type ProviderId } from '@studio/providers';
import { readCliConfigFileRaw } from './cli-config-file';
import { readAuthToken, readSharedConfig, updateSharedConfig } from './shared-config';

/**
 * Each provider's config, validated against its descriptor's schema. Until
 * configs get a section of their own, each maps onto the shared.json field
 * builds of every version read: the WordPress.com config is the Studio
 * sign-in (`authToken`), the Anthropic one the saved key (`anthropicApiKey`), and
 * the custom endpoint's the connection (`customEndpoint`).
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
	anthropic: {
		read: async () => {
			const { anthropicApiKey } = await readAiFields();
			return anthropicApiKey && { method: 'api-key', apiKey: anthropicApiKey };
		},
		write: async ( config ) => {
			await updateAiFields( { anthropicApiKey: config?.apiKey } );
		},
	},
	custom: {
		read: async () => ( await readSharedConfig() ).customEndpoint,
		write: async ( customEndpoint ) => {
			await updateSharedConfig( { customEndpoint } );
		},
	},
};

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
}
