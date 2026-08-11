import { z } from 'zod';
import {
	lockCliConfigFile,
	readCliConfigFileRaw,
	unlockCliConfigFile,
	writeCliConfigFileRaw,
} from '../lib/cli-config-file';
import { validateAnthropicApiKey } from './anthropic-key';
import {
	DEFAULT_AI_PROVIDER,
	isAiProviderId,
	type AiProviderId,
	type AiSettings,
} from './providers';

/** A key Anthropic definitively rejected; carries a user-facing message. */
export class InvalidAnthropicApiKeyError extends Error {
	constructor( message: string ) {
		super( message );
		this.name = 'InvalidAnthropicApiKeyError';
	}
}

/**
 * Reads and writes the AI provider settings in the CLI-owned
 * `~/.studio/cli.json`, shared by the CLI, the local web server and the desktop
 * app. The schema here is loose on purpose: the CLI owns the full one, so
 * unrelated fields must survive the write-back untouched.
 */

const aiSettingsConfigSchema = z
	.object( {
		aiProvider: z.string().optional(),
		anthropicApiKey: z.string().optional(),
	} )
	.loose();

type AiSettingsConfig = z.infer< typeof aiSettingsConfigSchema >;

const KEY_PREFIX_LENGTH = 16;
const KEY_SUFFIX_LENGTH = 4;

// Enough of the key to recognise it, never enough to use it.
function previewKey( key: string ): string {
	if ( key.length <= KEY_PREFIX_LENGTH + KEY_SUFFIX_LENGTH ) {
		return key.slice( 0, KEY_PREFIX_LENGTH );
	}
	return `${ key.slice( 0, KEY_PREFIX_LENGTH ) }...${ key.slice( -KEY_SUFFIX_LENGTH ) }`;
}

function toAiSettings( config: AiSettingsConfig ): AiSettings {
	const key = config.anthropicApiKey;
	return {
		provider:
			config.aiProvider !== undefined && isAiProviderId( config.aiProvider )
				? config.aiProvider
				: DEFAULT_AI_PROVIDER,
		hasAnthropicApiKey: Boolean( key ),
		anthropicApiKeyPreview: key ? previewKey( key ) : null,
	};
}

async function readAiSettingsConfig(): Promise< AiSettingsConfig > {
	return aiSettingsConfigSchema.parse( await readCliConfigFileRaw() );
}

export async function readAiSettings(): Promise< AiSettings > {
	return toAiSettings( await readAiSettingsConfig() );
}

async function updateAiSettings(
	mutate: ( config: AiSettingsConfig ) => void
): Promise< AiSettings > {
	await lockCliConfigFile();
	try {
		const config = aiSettingsConfigSchema.parse( await readCliConfigFileRaw() );
		mutate( config );
		await writeCliConfigFileRaw( config );
		return toAiSettings( config );
	} finally {
		await unlockCliConfigFile();
	}
}

/**
 * Stores or clears the Anthropic API key. A key Anthropic rejects is not
 * stored; an unverifiable one (offline, Anthropic outage) is. Clearing the key
 * falls back to WordPress.com, since the Anthropic provider needs one.
 */
export async function saveAnthropicApiKey( key: string | null ): Promise< AiSettings > {
	const trimmed = key === null ? null : key.trim();

	if ( trimmed ) {
		const validation = await validateAnthropicApiKey( trimmed );
		if ( validation.status === 'invalid' ) {
			throw new InvalidAnthropicApiKeyError( validation.message );
		}
	}

	return updateAiSettings( ( config ) => {
		if ( ! trimmed ) {
			delete config.anthropicApiKey;
			config.aiProvider = DEFAULT_AI_PROVIDER;
		} else {
			config.anthropicApiKey = trimmed;
		}
	} );
}

/**
 * Selects the provider for new conversations. Switching to Anthropic refuses a
 * key Anthropic rejects, but accepts an unverifiable one. Existing sessions
 * keep the provider recorded in their session context.
 */
export async function setAiProvider( provider: AiProviderId ): Promise< AiSettings > {
	if ( provider === 'anthropic-api-key' ) {
		const { anthropicApiKey } = await readAiSettingsConfig();
		if ( ! anthropicApiKey ) {
			throw new InvalidAnthropicApiKeyError( 'Add an Anthropic API key first.' );
		}
		const validation = await validateAnthropicApiKey( anthropicApiKey );
		if ( validation.status === 'invalid' ) {
			throw new InvalidAnthropicApiKeyError( validation.message );
		}
	}

	return updateAiSettings( ( config ) => {
		config.aiProvider = provider;
	} );
}
