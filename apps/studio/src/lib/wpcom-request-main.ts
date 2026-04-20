import wpcomFactory from '@studio/common/lib/wpcom-factory';
import wpcomXhrRequest from '@studio/common/lib/wpcom-xhr-request-factory';
import { getAuthenticationToken } from 'src/lib/oauth';

export type WpcomRequestArgs = {
	path: string;
	apiNamespace?: string;
	apiVersion?: string;
	method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
	body?: unknown;
};

/**
 * Thin helper around the Main-process `wpcom` client. Handles auth token lookup and
 * HTTP method dispatch so callers can write one-liners for GET/POST/PUT/DELETE requests.
 */
export async function wpcomRequest< T = unknown >( args: WpcomRequestArgs ): Promise< T > {
	const token = await getAuthenticationToken();
	if ( ! token ) {
		throw new Error( 'Not authenticated' );
	}
	const wpcom = wpcomFactory( token.accessToken, wpcomXhrRequest );

	const reqArgs: Record< string, unknown > = { path: args.path };
	if ( args.apiNamespace ) reqArgs.apiNamespace = args.apiNamespace;
	if ( args.apiVersion ) reqArgs.apiVersion = args.apiVersion;

	const method = ( args.method ?? 'GET' ).toUpperCase();

	if ( method === 'GET' ) {
		return ( await wpcom.req.get( reqArgs ) ) as T;
	}
	if ( method === 'POST' ) {
		return ( await wpcom.req.post( reqArgs, args.body ?? {} ) ) as T;
	}
	if ( method === 'PUT' ) {
		return ( await wpcom.req.put( reqArgs, args.body ?? {} ) ) as T;
	}
	// DELETE
	return ( await wpcom.req.del( reqArgs ) ) as T;
}
