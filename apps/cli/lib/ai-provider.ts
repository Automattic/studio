export const AI_PROVIDERS = {
	wpcom: 'WordPress.com',
	'anthropic-claude': 'Anthropic · Claude auth',
	'anthropic-api-key': 'Anthropic · API key',
} as const;

export type AiProviderId = keyof typeof AI_PROVIDERS;

export const DEFAULT_AI_PROVIDER: AiProviderId = 'anthropic-api-key';
export const DEFAULT_WPCOM_AI_GATEWAY_BASE_URL =
	'https://public-api.wordpress.com/wpcom/v2/ai-api-proxy';
export const WPCOM_AI_FEATURE_HEADER = 'studio-assistant-anthropic';
