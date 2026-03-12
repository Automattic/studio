import childProcess from 'child_process';
import { password } from '@inquirer/prompts';
import { __ } from '@wordpress/i18n';
import {
	DEFAULT_AI_PROVIDER,
	DEFAULT_WPCOM_AI_GATEWAY_BASE_URL,
	type AiProviderId,
	WPCOM_AI_FEATURE_HEADER,
} from 'cli/lib/ai-provider';
import {
	getAiProvider,
	getAnthropicApiKey,
	getAuthToken,
	saveAiProvider,
	saveAnthropicApiKey,
} from 'cli/lib/appdata';
import { LoggerError } from 'cli/logger';

export function hasClaudeCodeAuth(): boolean {
	try {
		const output = childProcess.execFileSync( 'claude', [ 'auth', 'status' ], {
			encoding: 'utf8',
			timeout: 5000,
			stdio: [ 'pipe', 'pipe', 'pipe' ],
		} );
		return (
			output.toLowerCase().includes( 'authenticated' ) || ! output.toLowerCase().includes( 'not' )
		);
	} catch {
		return false;
	}
}

async function resolveAnthropicApiKey(): Promise< string | undefined > {
	const savedKey = await getAnthropicApiKey();
	if ( savedKey ) {
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

	await saveAnthropicApiKey( apiKey );
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

export function getAvailableAiProviders(): AiProviderId[] {
	const providers: AiProviderId[] = [ 'wpcom' ];
	if ( hasClaudeCodeAuth() ) {
		providers.push( 'anthropic-claude' );
	}
	providers.push( 'anthropic-api-key' );
	return providers;
}

export async function resolveInitialAiProvider(): Promise< AiProviderId > {
	const savedProvider = await getAiProvider();
	if ( savedProvider ) {
		if ( savedProvider === 'anthropic-claude' && ! hasClaudeCodeAuth() ) {
			return DEFAULT_AI_PROVIDER;
		}
		return savedProvider;
	}

	try {
		await getAuthToken();
		return 'wpcom';
	} catch {
		// If authentication is unavailable or invalid, fall back to the default provider.
	}

	return hasClaudeCodeAuth() ? 'anthropic-claude' : DEFAULT_AI_PROVIDER;
}

export async function saveSelectedAiProvider( provider: AiProviderId ): Promise< void > {
	await saveAiProvider( provider );
}

export async function prepareAiProvider( provider: AiProviderId ): Promise< void > {
	if ( provider === 'anthropic-api-key' ) {
		await resolveAnthropicApiKey();
	}
}

export async function resolveAiEnvironment(
	provider: AiProviderId
): Promise< Record< string, string > > {
	const env = { ...( process.env as Record< string, string > ) };

	delete env.ANTHROPIC_API_KEY;
	delete env.ANTHROPIC_AUTH_TOKEN;
	delete env.ANTHROPIC_BASE_URL;
	delete env.ANTHROPIC_CUSTOM_HEADERS;
	delete env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS;

	if ( provider === 'wpcom' ) {
		const token = await getAuthToken();
		env.ANTHROPIC_BASE_URL = getWpcomAiGatewayBaseUrl();
		env.ANTHROPIC_AUTH_TOKEN = token.accessToken;
		env.ANTHROPIC_CUSTOM_HEADERS = buildAnthropicCustomHeaders( {
			'X-WPCOM-AI-Feature': WPCOM_AI_FEATURE_HEADER,
		} );
		env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = '1';
		return env;
	}

	if ( provider === 'anthropic-claude' ) {
		if ( hasClaudeCodeAuth() ) {
			return env;
		}

		throw new LoggerError(
			__( 'Claude auth is not available. Choose another provider with /provider.' )
		);
	}

	const apiKey = await getAnthropicApiKey();
	if ( apiKey ) {
		env.ANTHROPIC_API_KEY = apiKey;
		return env;
	}

	throw new LoggerError(
		__( 'Anthropic API key required. Switch to Anthropic · API key with /provider to save one.' )
	);
}
