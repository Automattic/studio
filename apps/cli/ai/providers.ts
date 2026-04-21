import { password } from '@inquirer/prompts';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { __ } from '@wordpress/i18n';
import { readCliConfig, updateCliConfigWithPartial } from 'cli/lib/cli-config/core';
import { LoggerError } from 'cli/logger';

export const AI_PROVIDERS = {
	wpcom: 'WordPress.com',
	'anthropic-api-key': 'Anthropic · API key',
} as const;

export type AiProviderId = keyof typeof AI_PROVIDERS;

export const DEFAULT_AI_PROVIDER: AiProviderId = 'wpcom';
export const AI_PROVIDER_PRIORITY: AiProviderId[] = [ 'wpcom', 'anthropic-api-key' ];

const DEFAULT_WPCOM_AI_GATEWAY_BASE_URL = 'https://public-api.wordpress.com/wpcom/v2/ai-api-proxy';
const WPCOM_AI_FEATURE_HEADER = 'studio-assistant-anthropic';

export interface ResolveAiEnvironmentOptions {
	sessionId?: string;
}

export interface AiProviderDefinition {
	id: AiProviderId;
	autoFallbackWhenUnavailable: boolean;
	isVisible: () => Promise< boolean >;
	isReady: () => Promise< boolean >;
	prepare: ( options?: { force?: boolean } ) => Promise< void >;
	resolveEnv: ( options?: ResolveAiEnvironmentOptions ) => Promise< Record< string, string > >;
}

async function resolveAnthropicApiKey( options?: {
	force?: boolean;
} ): Promise< string | undefined > {
	const { anthropicApiKey: savedKey } = await readCliConfig();
	if ( savedKey && ! options?.force ) {
		return savedKey;
	}

	const apiKey = await password( {
		message: __( 'Enter your Anthropic API key (will be saved for future use):' ),
		mask: '*',
		validate: ( value ) => {
			if ( ! value.trim() ) {
				return __( 'API key is required' );
			}
			return true;
		},
	} );

	await updateCliConfigWithPartial( { anthropicApiKey: apiKey } );
	return apiKey;
}

function buildAnthropicCustomHeaders( headers: Record< string, string > ): string {
	return Object.entries( headers )
		.map( ( [ name, value ] ) => `${ name }: ${ value }` )
		.join( '\n' );
}

function getWpcomAiGatewayBaseUrl(): string {
	const customBaseUrl = process.env.WPCOM_AI_PROXY_BASE_URL?.trim();
	return customBaseUrl || DEFAULT_WPCOM_AI_GATEWAY_BASE_URL;
}

async function hasValidWpcomAuth(): Promise< boolean > {
	const token = await readAuthToken();
	return token !== null;
}

function readInlineWpcomToken(): string | null {
	return process.env.STUDIO_WPCOM_TOKEN?.trim() || null;
}

export function hasInlineWpcomAuth(): boolean {
	return readInlineWpcomToken() !== null;
}

function createBaseEnvironment(): Record< string, string > {
	const env = { ...( process.env as Record< string, string > ) };

	delete env.ANTHROPIC_API_KEY;
	delete env.ANTHROPIC_AUTH_TOKEN;
	delete env.ANTHROPIC_BASE_URL;
	delete env.ANTHROPIC_CUSTOM_HEADERS;
	delete env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS;
	delete env.CLAUDE_CODE_MAX_RETRIES;

	// Fail fast on transient API errors so the user-mediated retry prompt can
	// intervene instead of the SDK burning through its default 10 retries.
	if ( ! env.CLAUDE_CODE_MAX_RETRIES ) {
		env.CLAUDE_CODE_MAX_RETRIES = '1';
	}

	return env;
}

const AI_PROVIDER_DEFINITIONS: Record< AiProviderId, AiProviderDefinition > = {
	wpcom: {
		id: 'wpcom',
		autoFallbackWhenUnavailable: true,
		isVisible: async () => true,
		isReady: async () => hasInlineWpcomAuth() || ( await hasValidWpcomAuth() ),
		prepare: async () => {
			if ( hasInlineWpcomAuth() || ( await hasValidWpcomAuth() ) ) {
				return;
			}

			throw new LoggerError( __( 'WordPress.com login required. Use /login to authenticate.' ) );
		},
		resolveEnv: async ( options ) => {
			const inlineToken = readInlineWpcomToken();
			const accessToken = inlineToken ?? ( await readAuthToken() )?.accessToken;
			if ( ! accessToken ) {
				throw new LoggerError( __( 'WordPress.com login required. Use /login to authenticate.' ) );
			}
			const env = createBaseEnvironment();
			env.ANTHROPIC_BASE_URL = getWpcomAiGatewayBaseUrl();
			env.ANTHROPIC_AUTH_TOKEN = accessToken;
			const customHeaders: Record< string, string > = {
				'X-WPCOM-AI-Feature': WPCOM_AI_FEATURE_HEADER,
			};
			if ( options?.sessionId ) {
				customHeaders[ 'X-WPCOM-Session-ID' ] = options.sessionId;
			}
			env.ANTHROPIC_CUSTOM_HEADERS = buildAnthropicCustomHeaders( customHeaders );
			env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = '1';
			// The default agent retry count (10) causes the CLI to hang for
			// minutes when the WPCOM proxy returns a 429 (e.g. usage cap
			// reached). Retries don't recover the cap, so fail fast and let
			// the UI surface the error.
			env.CLAUDE_CODE_MAX_RETRIES = '0';
			return env;
		},
	},
	'anthropic-api-key': {
		id: 'anthropic-api-key',
		autoFallbackWhenUnavailable: false,
		isVisible: async () => true,
		isReady: async () => {
			const { anthropicApiKey } = await readCliConfig();
			return Boolean( anthropicApiKey );
		},
		prepare: async ( options ) => {
			await resolveAnthropicApiKey( options );
		},
		resolveEnv: async () => {
			const { anthropicApiKey: apiKey } = await readCliConfig();
			if ( ! apiKey ) {
				throw new LoggerError(
					__(
						'Anthropic API key required. Switch to Anthropic · API key with /provider to save one.'
					)
				);
			}

			const env = createBaseEnvironment();
			env.ANTHROPIC_API_KEY = apiKey;
			return env;
		},
	},
};

export function getAiProviderDefinition( provider: AiProviderId ): AiProviderDefinition {
	return AI_PROVIDER_DEFINITIONS[ provider ];
}
