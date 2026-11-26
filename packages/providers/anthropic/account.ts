import { __ } from '@wordpress/i18n';
import { ConnectError } from '../errors';
import { ANTHROPIC_MODELS_URL, anthropicHeaders } from './api';
import { anthropicConnectInput, anthropicSetupTokenInput } from './descriptor';
import type { AnthropicConfig } from './config';
import type { AccountServices } from '../types';
import type { z } from 'zod';

const VALIDATION_TIMEOUT_MS = 10_000;

type AnthropicValidation =
	| { status: 'valid' }
	| { status: 'invalid'; message: string }
	| { status: 'unverifiable'; message: string };

/**
 * Checks an Anthropic credential against the live API with a cheap
 * authenticated request (listing models consumes no tokens).
 *
 * Only a definitive authentication failure reports `invalid`; rate limits,
 * server errors, and network failures report `unverifiable` so callers can
 * decide whether to accept the credential anyway (e.g. saving while offline)
 * rather than locking the user out on an Anthropic outage. A subscription
 * token is only refused on a 401, since a 403 may mean the endpoint, not the
 * token, is off limits to it.
 */
export async function validateAnthropicConfig(
	config: AnthropicConfig
): Promise< AnthropicValidation > {
	let response: Response;
	try {
		response = await fetch( `${ ANTHROPIC_MODELS_URL }?limit=1`, {
			headers: anthropicHeaders( config ),
			signal: AbortSignal.timeout( VALIDATION_TIMEOUT_MS ),
		} );
	} catch {
		return {
			status: 'unverifiable',
			message: __( 'Could not reach Anthropic to verify the credential.' ),
		};
	}

	if ( response.ok ) {
		return { status: 'valid' };
	}
	if ( response.status === 401 || ( response.status === 403 && config.method === 'api-key' ) ) {
		return {
			status: 'invalid',
			message:
				config.method === 'api-key'
					? __( 'Anthropic rejected this API key. Check the key and try again.' )
					: __( 'Anthropic rejected this token. Run claude setup-token again.' ),
		};
	}
	return {
		status: 'unverifiable',
		message: __( 'Could not verify the credential with Anthropic.' ),
	};
}

function parseInput< Schema extends z.ZodType >(
	schema: Schema,
	input: unknown
): z.infer< Schema > {
	const parsed = schema.safeParse( input );
	if ( ! parsed.success ) {
		throw new ConnectError( parsed.error.issues[ 0 ].message );
	}
	return parsed.data;
}

// A credential Anthropic rejects is refused; an unverifiable one (offline, an
// Anthropic outage) is accepted.
export const anthropicAccount: AccountServices< AnthropicConfig > = {
	async connect( method, input ) {
		const config: AnthropicConfig =
			method === 'setup-token'
				? { method: 'setup-token', token: parseInput( anthropicSetupTokenInput(), input ).token }
				: { method: 'api-key', apiKey: parseInput( anthropicConnectInput(), input ).apiKey };
		const validation = await validateAnthropicConfig( config );
		if ( validation.status === 'invalid' ) {
			throw new ConnectError( validation.message );
		}
		return config;
	},
};
