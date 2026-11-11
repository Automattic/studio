import { getProviderDescriptor, type ProviderConfigs, type ProviderId } from '@studio/providers';
import { readCliConfigFileRaw } from './cli-config-file';
import { readAuthToken, readSharedConfig, updateSharedConfig } from './shared-config';

/**
 * Each provider's config, validated against its descriptor's schema. Until
 * configs get a section of their own, each maps onto the shared.json field
 * builds of every version read: the WordPress.com config is the Studio
 * sign-in (`authToken`), the Anthropic one the saved key (`anthropicApiKey`).
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

async function readStoredConfig( provider: ProviderId ): Promise< unknown > {
	if ( provider === 'wpcom' ) {
		const token = await readAuthToken();
		return token ? { token: token.accessToken } : undefined;
	}
	const { anthropicApiKey } = await readAiFields();
	return anthropicApiKey ? { method: 'api-key', apiKey: anthropicApiKey } : undefined;
}

export async function readProviderConfig< Id extends ProviderId >(
	provider: Id
): Promise< ProviderConfigs[ Id ] | undefined > {
	const parsed = getProviderDescriptor( provider ).configSchema.safeParse(
		await readStoredConfig( provider )
	);
	return parsed.success ? parsed.data : undefined;
}

// Removes the config when `config` is undefined. Signing in to Studio stores
// the WordPress.com one.
export async function writeProviderConfig(
	provider: 'anthropic',
	config: ProviderConfigs[ 'anthropic' ] | undefined
): Promise< void > {
	const valid = config && getProviderDescriptor( provider ).configSchema.parse( config );
	await updateAiFields( { anthropicApiKey: valid ? valid.apiKey : undefined } );
}
