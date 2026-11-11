import { InvalidAiProviderCredentialsError } from './types';
import type { StudioAiProvider } from './index';
import type { AiProvider, ApiKeyValidation } from './types';

export interface ApiKeyCoreProvider extends Omit< AiProvider, 'auth' > {
	auth: {
		type: 'api-key';
		validate: ( key: string ) => Promise< ApiKeyValidation >;
	};
}

export interface ApiKeyStudioProviderOptions {
	envKey: string;
	extraEnvironmentKeys?: readonly string[];
	baseURL: string;
	getInvalidKeyMessage: () => string;
	getPrompt: () => string;
	getMissingKeyMessage: () => string;
	getErrorHint: () => string;
	getNoSavedKeyInfo: () => string;
	getEnvRequiredMessage: () => string;
	missingEnvReason: string;
}

export function createApiKeyStudioProvider(
	provider: ApiKeyCoreProvider,
	options: ApiKeyStudioProviderOptions
): StudioAiProvider {
	const {
		envKey,
		extraEnvironmentKeys = [],
		baseURL,
		getInvalidKeyMessage,
		getPrompt,
		getMissingKeyMessage,
		getErrorHint,
		getNoSavedKeyInfo,
		getEnvRequiredMessage,
		missingEnvReason,
	} = options;

	return {
		...provider,
		auth: {
			type: 'api-key',
			async validate( key ) {
				const validation = await provider.auth.validate( key );
				return validation.status === 'invalid'
					? { status: 'invalid', message: getInvalidKeyMessage() }
					: validation;
			},
			getPrompt,
			getMissingKeyMessage,
		},
		environmentKeys: [ envKey, ...extraEnvironmentKeys ],
		autoFallbackWhenUnavailable: false,
		getErrorHint,
		getConnectionMessages: async ( apiKey ) => ( apiKey ? {} : { info: getNoSavedKeyInfo() } ),
		async resolveEnv( { apiKey } ) {
			if ( ! apiKey ) {
				throw new InvalidAiProviderCredentialsError( getEnvRequiredMessage() );
			}
			return { [ envKey ]: apiKey };
		},
		resolveCredentials( env ) {
			const apiKey = env[ envKey ]?.trim();
			if ( ! apiKey ) {
				return { ok: false, reason: missingEnvReason };
			}
			return { ok: true, creds: { apiKey, baseURL } };
		},
	};
}
