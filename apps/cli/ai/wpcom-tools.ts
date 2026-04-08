import { tool } from '@anthropic-ai/claude-agent-sdk';
import wpcomFactory from '@studio/common/lib/wpcom-factory';
import wpcomXhrRequest from '@studio/common/lib/wpcom-xhr-request-factory';
import { z } from 'zod/v4';

// Responses larger than this threshold will have heavy fields stripped.
const COMPACT_THRESHOLD_CHARS = 80_000;

/**
 * Strips known bloated fields from API responses to stay within MCP tool result
 * size limits (~100k characters).
 *
 * Two cases are handled:
 * 1. Single object with plan.features (e.g. /sites/{id}): the features sub-field
 *    alone can be 60K+ chars. The agent only needs a few plan properties.
 * 2. Array responses (e.g. /templates, /posts): when the list is too large, strip
 *    heavy per-item fields (content, _links) so the agent can identify items and
 *    fetch individual ones for full content.
 */
function compactResponse( result: ApiResponse ): ApiResponse {
	if ( ! result || typeof result !== 'object' ) {
		return result;
	}

	// Case 1: plan.features can be 60K+ chars — keep only essential plan properties
	if ( ! Array.isArray( result ) && result.plan?.features ) {
		result = {
			...result,
			plan: {
				product_id: result.plan.product_id,
				product_slug: result.plan.product_slug,
				product_name_short: result.plan.product_name_short,
				expired: result.plan.expired,
				is_free: result.plan.is_free,
			},
		};
	}

	// Case 2: array responses — strip heavy fields when the response is too large
	if ( Array.isArray( result ) ) {
		const fullSize = JSON.stringify( result ).length;
		if ( fullSize > COMPACT_THRESHOLD_CHARS ) {
			result = result.map( ( item: ApiResponse ) => {
				if ( item && typeof item === 'object' && ! Array.isArray( item ) ) {
					const { content, _links, ...rest } = item;
					return rest;
				}
				return item;
			} );
		}
	}

	return result;
}

function errorResult( message: string ) {
	return {
		content: [ { type: 'text' as const, text: message } ],
		isError: true,
	};
}

function textResult( text: string ) {
	return {
		content: [ { type: 'text' as const, text } ],
	};
}

function getErrorMessage( error: unknown ): string {
	if ( error instanceof Error ) {
		return error.message;
	}
	return String( error );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiResponse = any;

/**
 * Creates a generic WP.com REST API tool for managing a remote WordPress.com site.
 * Instead of hardcoding individual endpoints, this provides a single flexible tool
 * that can call any WP.com REST API endpoint. The AI agent determines the correct
 * endpoints based on its knowledge of the WordPress.com REST API.
 */
export function createWpcomToolDefinitions( token: string, siteId: number ) {
	const wpcom = wpcomFactory( token, wpcomXhrRequest );

	const wpcomRequestTool = tool(
		'wpcom_request',
		`Makes a request to the WordPress REST API (wp/v2) or WordPress.com REST API (v1.1) for site ${ siteId }. ` +
			'Defaults to the WordPress REST API (wp/v2). Use this to manage posts, pages, templates, template parts, ' +
			'media, plugins, themes, settings, and any other site resource. ' +
			'The path is relative to /sites/{siteId}/ — for example, pass "/posts" to call /wp/v2/sites/{siteId}/posts. ' +
			'For non-site endpoints, start the path with "!" (e.g., "!/me") to use an absolute path.',
		{
			method: z
				.enum( [ 'GET', 'POST', 'PUT', 'DELETE' ] )
				.describe( 'HTTP method for the request.' ),
			path: z
				.string()
				.describe(
					'API path relative to /sites/{siteId}/, e.g. "/posts", "/posts/123", "/templates", "/template-parts". ' +
						'Prefix with "!" to use an absolute path (e.g. "!/me").'
				),
			query: z
				.record( z.string(), z.unknown() )
				.optional()
				.describe(
					'Query parameters as key-value pairs, e.g. { "per_page": 20, "status": "publish" }.'
				),
			body: z
				.record( z.string(), z.unknown() )
				.optional()
				.describe( 'Request body for POST/PUT requests as key-value pairs.' ),
			apiNamespace: z
				.string()
				.optional()
				.describe(
					'API namespace. Defaults to "wp/v2" (WordPress REST API). ' +
						'Set to "wpcom/v2" for WordPress.com v2 endpoints, or omit/leave empty to fall back to WP.com REST API v1.1. ' +
						'Use wp/v2 for standard WordPress resources (posts, pages, templates, media, users, etc.). ' +
						'Use WP.com v1.1 (set apiNamespace to "") for WP.com-specific endpoints like /plugins, /themes/mine.'
				),
		},
		async ( args ) => {
			try {
				let fullPath: string;
				if ( args.path.startsWith( '!' ) ) {
					fullPath = args.path.slice( 1 );
				} else {
					const relativePath = args.path.startsWith( '/' ) ? args.path : `/${ args.path }`;
					fullPath = `/sites/${ siteId }${ relativePath }`;
				}

				// Default to wp/v2 namespace (WordPress REST API).
				// An empty string means "use WP.com REST API v1.1" (no apiNamespace → isRestAPI=true in wpcom-xhr-request).
				const apiNamespace = args.apiNamespace ?? 'wp/v2';
				const queryParams: Record< string, unknown > = { ...( args.query ?? {} ) };
				if ( apiNamespace ) {
					queryParams.apiNamespace = apiNamespace;
				}

				let result: ApiResponse;
				switch ( args.method ) {
					case 'GET':
						result = await wpcom.req.get< ApiResponse >( fullPath, queryParams );
						break;
					case 'POST':
						result = await wpcom.req.post< ApiResponse >( fullPath, queryParams, args.body ?? {} );
						break;
					case 'PUT':
						result = await wpcom.req.put< ApiResponse >( fullPath, queryParams, args.body ?? {} );
						break;
					case 'DELETE':
						result = await wpcom.req.del< ApiResponse >( fullPath, queryParams );
						break;
				}

				const compacted = compactResponse( result );
				return textResult( JSON.stringify( compacted, null, 2 ) );
			} catch ( error ) {
				return errorResult(
					`WP.com API request failed (${ args.method } ${ args.path }): ${ getErrorMessage(
						error
					) }`
				);
			}
		}
	);

	return [ wpcomRequestTool ];
}
