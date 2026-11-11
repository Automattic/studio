import { createConnectionStream } from '@studio/agent/shared/models';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import type { AiConnection } from '@studio/providers';

// The SDKs add `x-stainless-*` telemetry headers that the WordPress.com
// proxy's CORS policy rejects, so they are dropped.
const corsSafeFetch: typeof fetch = ( input, init ) => {
	const headers = new Headers( init?.headers ?? ( input instanceof Request ? input.headers : {} ) );
	for ( const name of [ ...headers.keys() ] ) {
		if ( name.startsWith( 'x-stainless' ) ) {
			headers.delete( name );
		}
	}
	return fetch( input, { ...init, headers } );
};

export function createStreamFn( ai: AiConnection ): StreamFn {
	const stream = createConnectionStream( ai );
	return ( model, context, options ) =>
		stream( model, context, { ...options, apiKey: ai.apiKey, fetch: corsSafeFetch } );
}
