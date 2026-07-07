/**
 * Custom PromptFoo grader provider that calls Claude via the WP.com AI proxy.
 * Reuses Studio's auth token so no separate API key is needed.
 *
 * PromptFoo loads this as a module provider for llm-rubric assertions.
 */

import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const WPCOM_AI_PROXY = 'https://public-api.wordpress.com/wpcom/v2/ai-api-proxy';
const GRADER_MODEL = 'claude-haiku-4-5-20251001';

function readStudioAuthToken() {
	const configPath = join( homedir(), '.studio', 'shared.json' );
	try {
		const config = JSON.parse( readFileSync( configPath, 'utf-8' ) );
		if ( config.authToken?.accessToken && Date.now() < config.authToken.expirationTime ) {
			return config.authToken.accessToken;
		}
	} catch {
		// Config doesn't exist or is invalid
	}
	return null;
}

function getAuthToken() {
	// Prefer direct API key if set (e.g. in CI)
	if ( process.env.ANTHROPIC_API_KEY ) {
		return {
			token: process.env.ANTHROPIC_API_KEY,
			baseUrl: 'https://api.anthropic.com',
			isApiKey: true,
		};
	}
	// Fall back to Studio's WP.com auth
	const wpcomToken = readStudioAuthToken();
	if ( wpcomToken ) {
		return { token: wpcomToken, baseUrl: WPCOM_AI_PROXY, isApiKey: false };
	}
	return null;
}

/** @implements {import('promptfoo').ApiProvider} */
class StudioGraderProvider {
	id() {
		return `studio-grader:${ GRADER_MODEL }`;
	}

	async callApi( prompt ) {
		const auth = getAuthToken();
		if ( ! auth ) {
			throw new Error(
				'No auth available for grader. Run "studio auth login" or set ANTHROPIC_API_KEY.'
			);
		}

		const headers = {
			'Content-Type': 'application/json',
			'anthropic-version': '2023-06-01',
		};

		if ( auth.isApiKey ) {
			headers[ 'x-api-key' ] = auth.token;
		} else {
			headers[ 'Authorization' ] = `Bearer ${ auth.token }`;
			headers[ 'X-WPCOM-AI-Feature' ] = 'studio-assistant-anthropic';
		}

		const body = {
			model: GRADER_MODEL,
			max_tokens: 1024,
			messages: [ { role: 'user', content: prompt } ],
		};

		const url = auth.isApiKey
			? 'https://api.anthropic.com/v1/messages'
			: `${ WPCOM_AI_PROXY }/v1/messages`;

		const response = await fetch( url, {
			method: 'POST',
			headers,
			body: JSON.stringify( body ),
		} );

		if ( ! response.ok ) {
			const text = await response.text();
			throw new Error( `Grader API call failed (${ response.status }): ${ text.slice( 0, 200 ) }` );
		}

		const data = await response.json();
		const output = data.content?.[ 0 ]?.text ?? '';

		return {
			output,
			tokenUsage: {
				prompt: data.usage?.input_tokens,
				completion: data.usage?.output_tokens,
				total: ( data.usage?.input_tokens ?? 0 ) + ( data.usage?.output_tokens ?? 0 ),
			},
		};
	}
}

export default StudioGraderProvider;
