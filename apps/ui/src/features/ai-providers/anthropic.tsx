import { __ } from '@wordpress/i18n';
import { ClaudeIcon } from '@/lib/icons';
import { createApiKeyUiProvider } from './api-key-connection';

export const anthropicUiProvider = createApiKeyUiProvider( {
	icon: ClaudeIcon,
	getTitle: () => __( 'Anthropic' ),
	getDescription: () => __( 'Use Claude with your own API key.' ),
	docsLinksKey: 'docsAnthropicApiKey',
	getFormLabel: () => __( 'Anthropic connection' ),
	getFieldTitle: () => __( 'Anthropic API key' ),
	getBillingNote: () => __( 'Usage is billed through your Anthropic account.' ),
	keyPlaceholder: 'sk-…',
} );
