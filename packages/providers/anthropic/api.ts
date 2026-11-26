import type { AnthropicConfig } from './config';

export const ANTHROPIC_MODELS_URL = 'https://api.anthropic.com/v1/models';

export const anthropicHeaders = ( config: AnthropicConfig ): Record< string, string > => ( {
	'anthropic-version': '2023-06-01',
	...( config.method === 'api-key'
		? { 'x-api-key': config.apiKey }
		: { Authorization: `Bearer ${ config.token }`, 'anthropic-beta': 'oauth-2025-04-20' } ),
} );
