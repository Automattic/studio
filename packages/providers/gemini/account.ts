import { __ } from '@wordpress/i18n';
import { ConnectError } from '../errors';
import { geminiConnectInput } from './descriptor';
import type { GeminiConfig } from './config';
import type { ProviderServices } from '../types';

const GEMINI_MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1';
const VALIDATION_TIMEOUT_MS = 10_000;

// Listing models costs no tokens. Google answers a bad key with a 400
// (API_KEY_INVALID) or a 403; a key that can't be checked (offline, an outage)
// is accepted.
export const geminiAccount: ProviderServices< GeminiConfig >[ 'account' ] = {
	async connect( _method, input ) {
		const parsed = geminiConnectInput().safeParse( input );
		if ( ! parsed.success ) {
			throw new ConnectError( parsed.error.issues[ 0 ].message );
		}
		const { apiKey } = parsed.data;
		const response = await fetch( GEMINI_MODELS_URL, {
			headers: { 'x-goog-api-key': apiKey },
			signal: AbortSignal.timeout( VALIDATION_TIMEOUT_MS ),
		} ).catch( () => undefined );
		if ( response && [ 400, 401, 403 ].includes( response.status ) ) {
			throw new ConnectError( __( 'Google rejected this API key. Check the key and try again.' ) );
		}
		return { method: 'api-key', apiKey };
	},
};
