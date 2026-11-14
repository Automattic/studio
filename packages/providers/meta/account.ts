import { __ } from '@wordpress/i18n';
import { ConnectError } from '../errors';
import { metaConnectInput } from './descriptor';
import type { MetaConfig } from './config';
import type { ProviderServices } from '../types';

const MODELS_URL = 'https://api.meta.ai/v1/models';
const REQUEST_TIMEOUT_MS = 15_000;

// Listing models costs nothing. Only a key Meta rejects is refused; one it can't check (offline,
// an outage) is accepted.
export const metaAccount: ProviderServices< MetaConfig >[ 'account' ] = {
	async connect( _method, input ) {
		const parsed = metaConnectInput().safeParse( input );
		if ( ! parsed.success ) {
			throw new ConnectError( parsed.error.issues[ 0 ].message );
		}
		const response = await fetch( MODELS_URL, {
			headers: { Authorization: `Bearer ${ parsed.data.apiKey }` },
			signal: AbortSignal.timeout( REQUEST_TIMEOUT_MS ),
		} ).catch( () => undefined );
		if ( response?.status === 401 ) {
			throw new ConnectError( __( 'Meta rejected this API key. Check the key and try again.' ) );
		}
		return { apiKey: parsed.data.apiKey };
	},
};
