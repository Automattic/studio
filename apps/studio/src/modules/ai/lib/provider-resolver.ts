import childProcess from 'child_process';
import { readSharedConfig } from '@studio/common/lib/shared-config';

const DEFAULT_WPCOM_AI_GATEWAY_BASE_URL = 'https://public-api.wordpress.com/wpcom/v2/ai-api-proxy';
const WPCOM_AI_FEATURE_HEADER = 'studio-assistant-anthropic';

export type AiProviderId = 'wpcom' | 'anthropic-claude' | 'anthropic-api-key';

function createBaseEnvironment(): Record< string, string > {
	const env = { ...( process.env as Record< string, string > ) };
	delete env.ANTHROPIC_API_KEY;
	delete env.ANTHROPIC_AUTH_TOKEN;
	delete env.ANTHROPIC_BASE_URL;
	delete env.ANTHROPIC_CUSTOM_HEADERS;
	delete env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS;
	return env;
}

function hasClaudeCodeAuth(): boolean {
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

async function getWpcomAuthToken(): Promise< string | null > {
	try {
		const config = await readSharedConfig();
		return config?.authToken?.accessToken ?? null;
	} catch {
		return null;
	}
}

function getWpcomAiGatewayBaseUrl(): string {
	return process.env.WPCOM_AI_PROXY_BASE_URL?.trim() || DEFAULT_WPCOM_AI_GATEWAY_BASE_URL;
}

/**
 * Resolve the environment variables needed for the agent SDK to authenticate.
 * Tries providers in priority order: wpcom → claude auth → api key.
 */
export async function resolveAgentEnv(
	apiKey?: string
): Promise< { env: Record< string, string >; provider: AiProviderId } > {
	// Try wpcom first
	const wpcomToken = await getWpcomAuthToken();
	if ( wpcomToken ) {
		const env = createBaseEnvironment();
		env.ANTHROPIC_BASE_URL = getWpcomAiGatewayBaseUrl();
		env.ANTHROPIC_AUTH_TOKEN = wpcomToken;
		env.ANTHROPIC_CUSTOM_HEADERS = `X-WPCOM-AI-Feature: ${ WPCOM_AI_FEATURE_HEADER }`;
		env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = '1';
		return { env, provider: 'wpcom' };
	}

	// Try Claude Code auth
	if ( hasClaudeCodeAuth() ) {
		return { env: createBaseEnvironment(), provider: 'anthropic-claude' };
	}

	// Fall back to API key
	if ( apiKey ) {
		const env = createBaseEnvironment();
		env.ANTHROPIC_API_KEY = apiKey;
		return { env, provider: 'anthropic-api-key' };
	}

	// No provider available — return base env, agent will error
	return { env: createBaseEnvironment(), provider: 'anthropic-api-key' };
}
