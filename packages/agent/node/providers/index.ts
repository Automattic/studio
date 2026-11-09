import { __ } from '@wordpress/i18n';
import { anthropicProvider } from './anthropic';
import { InvalidAiProviderCredentialsError } from './types';
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
	'anthropic-api-key': {
		...anthropicProvider,
		auth: {
			type: 'api-key',
			async validate( key ) {
				// The core provider reports API outcomes; Studio owns localized messages.
				const validation = await anthropicProvider.auth.validate( key );
				return validation.status === 'invalid'
					? {
							status: 'invalid',
							message: __( 'Anthropic rejected this API key. Check the key and try again.' ),
					  }
					: validation;
			},
			getPrompt: () => __( 'Enter your Anthropic API key (will be saved for future use):' ),
			getMissingKeyMessage: () => 'Add an Anthropic API key first.',
		},
		environmentKeys: [
			'ANTHROPIC_API_KEY',
			'ANTHROPIC_AUTH_TOKEN',
			'ANTHROPIC_BASE_URL',
			'ANTHROPIC_CUSTOM_HEADERS',
		],
		autoFallbackWhenUnavailable: false,
		getErrorHint: () => __( 'Use /api-key to update the Anthropic API key.' ),
		getConnectionMessages: async ( apiKey ) =>
			apiKey ? {} : { info: __( 'No Anthropic API key saved. Use /api-key to enter one.' ) },
		async resolveEnv( { apiKey } ) {
			if ( ! apiKey ) {
				throw new InvalidAiProviderCredentialsError(
					__(
						'Anthropic API key required. Switch to Anthropic · API key with /provider to save one.'
					)
				);
			}
			return { ANTHROPIC_API_KEY: apiKey };
		},
		resolveCredentials( env ) {
			const apiKey = env.ANTHROPIC_API_KEY?.trim();
			if ( ! apiKey ) {
				return {
					ok: false,
					reason:
						'Anthropic provider selected but ANTHROPIC_API_KEY is not set. Switch to the Anthropic · API key provider with /provider and save a key.',
				};
			}
			return { ok: true, creds: { apiKey, baseURL: 'https://api.anthropic.com' } };
		},
	},
};
