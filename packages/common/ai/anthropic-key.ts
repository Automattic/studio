import { __ } from '@wordpress/i18n';

const ANTHROPIC_MODELS_URL = 'https://api.anthropic.com/v1/models?limit=1';
const ANTHROPIC_API_VERSION = '2023-06-01';
const VALIDATION_TIMEOUT_MS = 10_000;

export type AnthropicKeyValidation =
	| { status: 'valid' }
	| { status: 'invalid'; message: string }
	| { status: 'unverifiable'; message: string };

/**
 * Checks a key against Anthropic by listing models, which consumes no tokens.
 *
 * Only an authentication failure is `invalid`. Rate limits, server errors and
 * network failures are `unverifiable`, so an outage can't lock users out.
 */
export async function validateAnthropicApiKey( apiKey: string ): Promise< AnthropicKeyValidation > {
	let response: Response;
	try {
		response = await fetch( ANTHROPIC_MODELS_URL, {
			headers: {
				'x-api-key': apiKey,
				'anthropic-version': ANTHROPIC_API_VERSION,
			},
			signal: AbortSignal.timeout( VALIDATION_TIMEOUT_MS ),
		} );
	} catch {
		return {
			status: 'unverifiable',
			message: __( 'Could not reach Anthropic to verify the API key.' ),
		};
	}

	if ( response.ok ) {
		return { status: 'valid' };
	}
	if ( response.status === 401 || response.status === 403 ) {
		return {
			status: 'invalid',
			message: __( 'Anthropic rejected this API key. Check the key and try again.' ),
		};
	}
	return {
		status: 'unverifiable',
		message: __( 'Could not verify the API key with Anthropic.' ),
	};
}
