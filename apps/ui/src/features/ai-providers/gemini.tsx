import { __ } from '@wordpress/i18n';
import { GeminiIcon } from '@/lib/icons';
import { createApiKeyUiProvider } from './api-key-connection';

export const geminiUiProvider = createApiKeyUiProvider( {
	icon: GeminiIcon,
	getTitle: () => __( 'Google Gemini' ),
	getDescription: () => __( 'Use Gemini with your own API key.' ),
	docsLinksKey: 'docsGeminiApiKey',
	getFormLabel: () => __( 'Google Gemini connection' ),
	getFieldTitle: () => __( 'Google Gemini API key' ),
	getBillingNote: () => __( 'Usage is billed through your Google AI Studio account.' ),
	keyPlaceholder: 'AIza…',
} );
