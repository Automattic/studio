import { tool } from '@anthropic-ai/claude-agent-sdk';
import wpcomFactory from '@studio/common/lib/wpcom-factory';
import wpcomXhrRequest from '@studio/common/lib/wpcom-xhr-request-factory';
import { z } from 'zod/v4';

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

export { stripNoisyFields };

// Fields that bloat API responses without being useful to the agent.
const NOISY_FIELDS = new Set( [
	'_links',
	'_embedded',
	'guid',
	'ping_status',
	'comment_status',
	'generated_slug',
	'permalink_template',
] );

/* eslint-disable @typescript-eslint/no-explicit-any */
function stripNoisyFields(
	data: any,
	removed = new Set< string >()
): { data: any; removed: Set< string > } {
	return { data: doStrip( data, removed ), removed };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function doStrip( data: any, removed: Set< string > ): any {
	if ( Array.isArray( data ) ) {
		return data.map( ( item ) => doStrip( item, removed ) );
	}
	if ( data !== null && typeof data === 'object' ) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const out: Record< string, any > = {};
		for ( const [ key, value ] of Object.entries( data ) ) {
			if ( NOISY_FIELDS.has( key ) ) {
				removed.add( key );
				continue;
			}
			// Drop `rendered` when `raw` is present in the same object
			if ( key === 'rendered' && 'raw' in data ) {
				removed.add( 'rendered (raw exists)' );
				continue;
			}
			out[ key ] = doStrip( value, removed );
		}
		return out;
	}
	return data;
}

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
			'For non-site endpoints, start the path with "!" (e.g., "!/me") to use an absolute path. ' +
			'IMPORTANT: To avoid oversized responses, always use the "fields" query parameter to request only the fields you need ' +
			'(e.g., query: { "fields": "ID,title,slug,status" }). Use "per_page" to limit list results (default: 10, max: 100).',
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

				// The Claude Agent SDK limits MCP tool results to ~25K tokens
				// (MAX_MCP_OUTPUT_TOKENS, default 25000). At ~3 chars/token
				// for JSON, 50K chars ≈ 16.7K tokens.
				const MAX_RESPONSE_CHARS = 50000;
				const json = JSON.stringify( result );

				if ( json.length <= MAX_RESPONSE_CHARS ) {
					return textResult( json );
				}

				// Over limit — strip noisy fields and retry
				const { data: cleaned, removed } = stripNoisyFields( result );
				const stripped = JSON.stringify( cleaned );
				const removedList = [ ...removed ].join( ', ' );
				const fieldsHint =
					`\n\n[Stripped fields: ${ removedList }. ` +
					'Re-request with "fields" parameter if you need any of these, or reduce "per_page".]';

				if ( stripped.length + fieldsHint.length <= MAX_RESPONSE_CHARS ) {
					return textResult( stripped + fieldsHint );
				}

				// Still too large — truncate
				const truncationNote =
					`\n\n[Truncated — response was ${ stripped.length.toLocaleString() } chars. ` +
					`Stripped fields: ${ removedList }. ` +
					'Use "fields" to request only needed fields (e.g., { "fields": "ID,title,slug" }), or reduce "per_page".]';
				return textResult(
					stripped.slice( 0, MAX_RESPONSE_CHARS - truncationNote.length ) + truncationNote
				);
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
