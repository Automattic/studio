import { DEFAULT_AI_PROVIDER, type AiSettings } from '@studio/common/ai/providers';
import { readCliConfig, updateCliConfigWithPartial } from 'cli/lib/cli-config/core';

const KEY_SUFFIX_LENGTH = 4;

function toAiSettings( config: {
	aiProvider?: AiSettings[ 'provider' ];
	anthropicApiKey?: string;
} ): AiSettings {
	const key = config.anthropicApiKey;
	return {
		provider: config.aiProvider ?? DEFAULT_AI_PROVIDER,
		hasAnthropicApiKey: Boolean( key ),
		anthropicApiKeySuffix: key ? key.slice( -KEY_SUFFIX_LENGTH ) : null,
	};
}

export async function readAiSettings(): Promise< AiSettings > {
	return toAiSettings( await readCliConfig() );
}

/**
 * Saves or clears the Anthropic API key and switches the AI provider
 * accordingly: a saved key selects the direct Anthropic provider, clearing it
 * falls back to WordPress.com. Existing sessions keep the provider recorded in
 * their session context; only new sessions pick up the change.
 */
export async function saveAnthropicApiKey( key: string | null ): Promise< AiSettings > {
	const update =
		key === null
			? { anthropicApiKey: undefined, aiProvider: DEFAULT_AI_PROVIDER }
			: { anthropicApiKey: key, aiProvider: 'anthropic-api-key' as const };
	await updateCliConfigWithPartial( update );
	return readAiSettings();
}
