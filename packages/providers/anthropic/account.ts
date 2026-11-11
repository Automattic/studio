import { __ } from '@wordpress/i18n';
import { InvalidCredentialError } from '../errors';
import { previewApiKey, type AnthropicConfig } from './config';
import type { Provider } from '../types';

const ANTHROPIC_MODELS_URL = 'https://api.anthropic.com/v1/models?limit=1';
const ANTHROPIC_API_VERSION = '2023-06-01';
const VALIDATION_TIMEOUT_MS = 10_000;

export type AnthropicKeyValidation =
	| { status: 'valid' }
	| { status: 'invalid'; message: string }
	| { status: 'unverifiable'; message: string };

/**
 * Checks an Anthropic API key against the live API with a cheap authenticated
 * request (listing models consumes no tokens).
 *
 * Only a definitive authentication failure reports `invalid`; rate limits,
 * server errors, and network failures report `unverifiable` so callers can
 * decide whether to accept the key anyway (e.g. saving while offline) rather
 * than locking the user out on an Anthropic outage.
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

export const anthropicAccount: Provider< AnthropicConfig >[ 'account' ] = {
	status: ( config ) => ( {
		connected: config !== undefined,
		method: config?.method ?? null,
		credentialPreview: config ? previewApiKey( config.apiKey ) : null,
	} ),
	// A key Anthropic rejects is refused; an unverifiable one (offline, an
	// Anthropic outage) is accepted.
	async connectApiKey( key ) {
		const apiKey = key.trim();
		if ( ! apiKey ) {
			throw new InvalidCredentialError( __( 'API key is required' ) );
		}
		const validation = await validateAnthropicApiKey( apiKey );
		if ( validation.status === 'invalid' ) {
			throw new InvalidCredentialError( validation.message );
		}
		return { method: 'api-key', apiKey };
	},
};
