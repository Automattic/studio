import { readCliConfigFileRaw } from '../lib/cli-config-file';
import { readSharedConfig, updateSharedConfig } from '../lib/shared-config';
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
 * Reads and writes the AI provider settings in `~/.studio/shared.json`, the
 * Desktop↔CLI shared state (where the WordPress.com auth token also lives).
 * Earlier builds stored both fields in the CLI-owned `cli.json`; reads fall
 * back to it so existing setups keep working, writes always target shared.json.
 */

interface AiProviderConfig {
	aiProvider?: string;
	anthropicApiKey?: string;
}

async function readLegacyCliConfigFields(): Promise< AiProviderConfig > {
	try {
		const { aiProvider, anthropicApiKey } = await readCliConfigFileRaw();
		return {
			aiProvider: typeof aiProvider === 'string' ? aiProvider : undefined,
			anthropicApiKey: typeof anthropicApiKey === 'string' ? anthropicApiKey : undefined,
		};
	} catch {
		return {};
	}
}

async function readAiProviderConfig(): Promise< AiProviderConfig > {
	const { aiProvider, anthropicApiKey } = await readSharedConfig();
	if ( aiProvider !== undefined || anthropicApiKey !== undefined ) {
		return { aiProvider, anthropicApiKey };
	}
	return readLegacyCliConfigFields();
}

/** The saved Anthropic API key, for processes that need the raw value. */
export async function readAnthropicApiKey(): Promise< string | undefined > {
	return ( await readAiProviderConfig() ).anthropicApiKey;
}

/** The saved provider selection, or undefined when none was ever chosen. */
export async function readSelectedAiProvider(): Promise< AiProviderId | undefined > {
	const { aiProvider } = await readAiProviderConfig();
	return aiProvider !== undefined && isAiProviderId( aiProvider ) ? aiProvider : undefined;
}

const KEY_PREFIX_LENGTH = 16;
const KEY_SUFFIX_LENGTH = 4;

// Enough to recognise the key, never enough to use it; a short key shows
// only its tail so most of it is not echoed back.
function previewKey( key: string ): string {
	if ( key.length <= KEY_PREFIX_LENGTH + KEY_SUFFIX_LENGTH ) {
		return `...${ key.slice( -KEY_SUFFIX_LENGTH ) }`;
	}
	return `${ key.slice( 0, KEY_PREFIX_LENGTH ) }...${ key.slice( -KEY_SUFFIX_LENGTH ) }`;
}

function toAiSettings( config: AiProviderConfig ): AiSettings {
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

export async function readAiSettings(): Promise< AiSettings > {
	return toAiSettings( await readAiProviderConfig() );
}

async function updateAiProviderConfig( update: AiProviderConfig ): Promise< AiSettings > {
	// Carry the legacy cli.json values over on first write so a partial update
	// (e.g. only aiProvider) doesn't orphan the other field there.
	const config = { ...( await readAiProviderConfig() ), ...update };
	await updateSharedConfig( config );
	return toAiSettings( config );
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

	return updateAiProviderConfig(
		trimmed
			? { anthropicApiKey: trimmed }
			: { anthropicApiKey: undefined, aiProvider: DEFAULT_AI_PROVIDER }
	);
}

/** Persists the provider without validation — for flows that already ran it. */
export async function persistSelectedAiProvider( provider: AiProviderId ): Promise< void > {
	await updateAiProviderConfig( { aiProvider: provider } );
}

/** Persists the key without validation — for flows that already ran it. */
export async function persistAnthropicApiKey( key: string ): Promise< void > {
	await updateAiProviderConfig( { anthropicApiKey: key } );
}
