import {
	DEFAULT_PROVIDER_ID,
	InvalidCredentialError,
	normalizeProviderId,
	toStoredProviderId,
	type AnthropicConfig,
	type Provider,
	type ProviderId,
} from '@studio/providers';
import {
	readAiFields,
	readProviderConfig,
	updateAiFields,
	writeProviderConfig,
} from './provider-config';

/**
 * The AI provider settings exposed to the settings UI. The Anthropic API key
 * itself never leaves the server — only its presence and a short preview.
 */
export interface AiSettings {
	provider: ProviderId;
	hasAnthropicApiKey: boolean;
	/** Truncated key for display (`sk-ant-…abcd`), or null when none is saved. */
	anthropicApiKeyPreview: string | null;
}

const KEY_PREFIX_LENGTH = 16;
const KEY_SUFFIX_LENGTH = 4;

// Enough to recognise the key, never enough to use it; a short key shows
// only its tail so most of it is not echoed back.
function previewApiKey( key: string ): string {
	if ( key.length <= KEY_PREFIX_LENGTH + KEY_SUFFIX_LENGTH ) {
		return `...${ key.slice( -KEY_SUFFIX_LENGTH ) }`;
	}
	return `${ key.slice( 0, KEY_PREFIX_LENGTH ) }...${ key.slice( -KEY_SUFFIX_LENGTH ) }`;
}

/** The saved chat provider, or undefined when none was ever chosen. */
export async function readSelectedAiProvider(): Promise< ProviderId | undefined > {
	const { aiProvider } = await readAiFields();
	return aiProvider === undefined ? undefined : normalizeProviderId( aiProvider );
}

export async function readAiSettings(): Promise< AiSettings > {
	const [ provider, anthropic ] = await Promise.all( [
		readSelectedAiProvider(),
		readProviderConfig( 'anthropic' ),
	] );
	return {
		provider: provider ?? DEFAULT_PROVIDER_ID,
		hasAnthropicApiKey: anthropic !== undefined,
		anthropicApiKeyPreview: anthropic ? previewApiKey( anthropic.apiKey ) : null,
	};
}

/** Persists the provider without validation — for flows that already ran it. */
export async function persistSelectedAiProvider( provider: ProviderId ): Promise< void > {
	await updateAiFields( { aiProvider: toStoredProviderId( provider ) } );
}

/**
 * Stores or clears the Anthropic API key, validated by `anthropic` (the
 * provider from `@studio/providers/node`). Clearing the key falls back to
 * WordPress.com, since the Anthropic provider needs one.
 */
export async function saveAnthropicApiKey(
	key: string | null,
	anthropic: Provider< AnthropicConfig >
): Promise< AiSettings > {
	if ( key?.trim() ) {
		await writeProviderConfig( 'anthropic', await anthropic.connectApiKey!( key ) );
	} else {
		await writeProviderConfig( 'anthropic', undefined );
		await persistSelectedAiProvider( DEFAULT_PROVIDER_ID );
	}
	return readAiSettings();
}

/**
 * Selects the provider for new conversations. Switching to Anthropic refuses a
 * key Anthropic rejects, but accepts an unverifiable one. Existing sessions
 * keep the provider recorded in their session context.
 */
export async function setAiProvider(
	provider: ProviderId,
	anthropic: Provider< AnthropicConfig >
): Promise< AiSettings > {
	if ( provider === 'anthropic' ) {
		const config = await readProviderConfig( 'anthropic' );
		if ( ! config ) {
			throw new InvalidCredentialError( 'Add an Anthropic API key first.' );
		}
		await anthropic.connectApiKey!( config.apiKey );
	}
	await persistSelectedAiProvider( provider );
	return readAiSettings();
}
