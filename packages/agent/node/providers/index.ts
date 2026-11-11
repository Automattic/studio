import { __ } from '@wordpress/i18n';
import { anthropicProvider } from './anthropic';
import { createApiKeyStudioProvider } from './api-key-provider';
import { geminiProvider } from './gemini';
import { wpcomProvider } from './wpcom';
import type { AiProvider, ApiKeyValidation, ProviderCredentials } from './types';
import type { AiProviderId } from '@studio/agent/protocol/providers';

export { InvalidAiProviderCredentialsError } from './types';

/** Studio's host adapter; inference providers implement only AiProvider. */
export interface StudioAiProvider extends Omit< AiProvider, 'auth' > {
	auth:
		| {
				type: 'api-key';
				validate: ( key: string ) => Promise< ApiKeyValidation >;
				getPrompt: () => string;
				getMissingKeyMessage: () => string;
		  }
		| { type: 'account'; isConnected: () => Promise< boolean > };
	environmentKeys: readonly string[];
	autoFallbackWhenUnavailable: boolean;
	isPreferred?: () => boolean;
	connect?: ( login: () => Promise< void > ) => Promise< boolean >;
	getConnectionMessages?: (
		apiKey?: string
	) => Promise< { status?: string; success?: string; info?: string } >;
	getErrorHint?: () => string;
	resolveEnv( options: {
		apiKey?: string;
		sessionId?: string;
		userAgent: string;
	} ): Promise< Record< string, string > >;
	resolveCredentials(
		env: Record< string, string >
	): { ok: true; creds: ProviderCredentials } | { ok: false; reason: string };
}

export const AI_BACKEND_PROVIDERS: Readonly< Record< AiProviderId, StudioAiProvider > > = {
	wpcom: wpcomProvider,
	'anthropic-api-key': createApiKeyStudioProvider( anthropicProvider, {
		envKey: 'ANTHROPIC_API_KEY',
		extraEnvironmentKeys: [
			'ANTHROPIC_AUTH_TOKEN',
			'ANTHROPIC_BASE_URL',
			'ANTHROPIC_CUSTOM_HEADERS',
		],
		baseURL: 'https://api.anthropic.com',
		getInvalidKeyMessage: () =>
			__( 'Anthropic rejected this API key. Check the key and try again.' ),
		getPrompt: () => __( 'Enter your Anthropic API key (will be saved for future use):' ),
		getMissingKeyMessage: () => 'Add an Anthropic API key first.',
		getErrorHint: () => __( 'Use /api-key to update the Anthropic API key.' ),
		getNoSavedKeyInfo: () => __( 'No Anthropic API key saved. Use /api-key to enter one.' ),
		getEnvRequiredMessage: () =>
			__( 'Anthropic API key required. Switch to Anthropic · API key with /provider to save one.' ),
		missingEnvReason:
			'Anthropic provider selected but ANTHROPIC_API_KEY is not set. Switch to the Anthropic · API key provider with /provider and save a key.',
	} ),
	'gemini-api-key': createApiKeyStudioProvider( geminiProvider, {
		envKey: 'GEMINI_API_KEY',
		extraEnvironmentKeys: [ 'GOOGLE_API_KEY', 'GEMINI_BASE_URL' ],
		baseURL: 'https://generativelanguage.googleapis.com/v1beta',
		getInvalidKeyMessage: () =>
			__( 'Google Gemini rejected this API key. Check the key and try again.' ),
		getPrompt: () => __( 'Enter your Google Gemini API key (will be saved for future use):' ),
		getMissingKeyMessage: () => 'Add a Google Gemini API key first.',
		getErrorHint: () => __( 'Use /api-key to update the Google Gemini API key.' ),
		getNoSavedKeyInfo: () => __( 'No Google Gemini API key saved. Use /api-key to enter one.' ),
		getEnvRequiredMessage: () =>
			__(
				'Google Gemini API key required. Switch to Google Gemini · API key with /provider to save one.'
			),
		missingEnvReason:
			'Google Gemini provider selected but GEMINI_API_KEY is not set. Switch to the Google Gemini · API key provider with /provider and save a key.',
	} ),
};
