import { getWpcomClient } from 'src/stores/wpcom-api';

export type WpcomRequestArgs = {
	path: string;
	apiNamespace?: string;
	apiVersion?: string;
	method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
	body?: unknown;
};

/**
 * Thin helper around the renderer-side `wpcom` client. Used by RTK endpoints
 * that need one-off authenticated requests to wpcom.
 */
export async function wpcomRequest< T = unknown >( args: WpcomRequestArgs ): Promise< T > {
	const wpcomClient = getWpcomClient();
	if ( ! wpcomClient ) {
		throw new Error( 'Not authenticated' );
	}

	const method = ( args.method ?? 'GET' ).toLowerCase() as 'get' | 'post' | 'put' | 'del';
	const reqArgs = { path: args.path, apiNamespace: args.apiNamespace, apiVersion: args.apiVersion };

	if ( method === 'get' ) {
		return ( await wpcomClient.req.get( reqArgs ) ) as T;
	}
	if ( method === 'post' ) {
		return ( await wpcomClient.req.post( reqArgs, args.body ?? {} ) ) as T;
	}
	if ( method === 'put' ) {
		return ( await wpcomClient.req.put( reqArgs, args.body ?? {} ) ) as T;
	}
	// DELETE
	return ( await wpcomClient.req.del( reqArgs ) ) as T;
}
