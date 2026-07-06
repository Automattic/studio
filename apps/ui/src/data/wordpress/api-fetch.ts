import type { Connector } from '@/data/core';
import type { SiteRestRequest } from '@studio/common/types/wordpress-rest';
import type { APIFetchOptions, FetchHandler } from '@wordpress/api-fetch';

export function createSiteApiFetchHandler( connector: Connector, siteId: string ): FetchHandler {
	return async ( options ) => {
		const response = await createResponse( connector, siteId, options );
		const shouldParse = options.parse !== false;

		if ( ! response.ok ) {
			if ( ! shouldParse ) {
				throw response;
			}
			throw await parseJson( response );
		}

		if ( ! shouldParse ) {
			return response;
		}

		if ( response.status === 204 ) {
			return null;
		}

		return await parseJson( response );
	};
}

async function createResponse(
	connector: Connector,
	siteId: string,
	options: APIFetchOptions
): Promise< Response > {
	const body = await serializeBody( options.body );
	const restResponse = await connector.fetchSiteRest( siteId, {
		path: options.path,
		url: options.url,
		method: options.method,
		headers: normalizeHeaders( options.headers ),
		...body,
		data: options.data,
		parse: options.parse,
	} );

	return new Response( restResponse.body, {
		status: restResponse.status,
		statusText: restResponse.statusText,
		headers: restResponse.headers,
	} );
}

function normalizeHeaders( headers: APIFetchOptions[ 'headers' ] ) {
	if ( ! headers ) {
		return {};
	}

	if ( headers instanceof Headers ) {
		return Object.fromEntries( headers.entries() );
	}

	if ( Array.isArray( headers ) ) {
		return Object.fromEntries( headers );
	}

	return headers;
}

async function serializeBody(
	body: APIFetchOptions[ 'body' ]
): Promise< Pick< SiteRestRequest, 'body' > > {
	if ( typeof body === 'string' ) {
		return { body };
	}

	if ( body instanceof URLSearchParams ) {
		return { body: body.toString() };
	}

	if ( body instanceof Blob ) {
		return { body: await body.arrayBuffer() };
	}

	if ( body instanceof ArrayBuffer ) {
		return { body };
	}

	if ( ArrayBuffer.isView( body ) ) {
		return { body: copyArrayBufferView( body ) };
	}

	return {};
}

function copyArrayBufferView( view: ArrayBufferView ) {
	const copy = new Uint8Array( view.byteLength );
	copy.set( new Uint8Array( view.buffer, view.byteOffset, view.byteLength ) );
	return copy.buffer;
}

async function parseJson( response: Response ) {
	try {
		return await response.json();
	} catch {
		throw {
			code: 'invalid_json',
			message: 'The response is not a valid JSON response.',
		};
	}
}
