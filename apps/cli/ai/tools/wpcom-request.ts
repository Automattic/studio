import { getConfigDirectory } from '@studio/common/lib/well-known-paths';
import wpcomFactory from '@studio/common/lib/wpcom-factory';
import wpcomXhrRequest from '@studio/common/lib/wpcom-xhr-request-factory';
import { Type } from 'typebox';
import { defineTool } from './define-tool';
import { REQUEST_BODY_FILES_RELATIVE_DIR, resolveRequestBody } from './request-body-files';
import { textResult } from './utils';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ApiResponse = any;

export const WPCOM_REQUEST_BODY_FILES_RELATIVE_DIR = REQUEST_BODY_FILES_RELATIVE_DIR;

interface WpcomRequestToolOptions {
	bodyFilesRoot?: string;
}

/**
 * Strips oversized fields from API responses that can't be filtered via query params.
 *
 * Special case: the WP.com /sites/{id} endpoint returns a `plan` object whose
 * `features` sub-field alone is 60K+ characters, which can push the tool result past
 * the agent's output budget. The v1.1 API doesn't support
 * sub-field filtering (e.g. `fields=plan.product_slug`), so we can't solve this
 * via query params. The agent only needs a few plan properties to gate features
 * since the system prompt hardcodes what each plan tier can do.
 *
 * This is NOT a pattern to follow for other endpoints. For general large responses,
 * the system prompt instructs the agent to use `_fields` (wp/v2) or `fields` (v1.1)
 * query params to request only the properties it needs.
 */
function stripOversizedFields( result: ApiResponse ): ApiResponse {
	if (
		result &&
		typeof result === 'object' &&
		! Array.isArray( result ) &&
		result.plan?.features
	) {
		return {
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
	return result;
}

function getErrorMessage( error: unknown ): string {
	if ( error instanceof Error ) {
		return error.message;
	}
	return String( error );
}

/**
 * Creates a generic WP.com REST API tool for managing a remote WordPress.com site.
 * Instead of hardcoding individual endpoints, this provides a single flexible tool
 * that can call any WP.com REST API endpoint. The AI agent determines the correct
 * endpoints based on its knowledge of the WordPress.com REST API.
 */
export function createWpcomRequestTool(
	token: string,
	siteId: number,
	options: WpcomRequestToolOptions = {}
) {
	const wpcom = wpcomFactory( token, wpcomXhrRequest );
	const bodyFilesRoot = options.bodyFilesRoot ?? getConfigDirectory();

	return defineTool(
		'wpcom_request',
		`Makes a request to the WordPress REST API (wp/v2) or WordPress.com REST API (v1.1) for site ${ siteId }. ` +
			'Defaults to the WordPress REST API (wp/v2). Use this to manage posts, pages, templates, template parts, ' +
			'media, plugins, themes, settings, and any other site resource. ' +
			'The path is relative to /sites/{siteId}/ — for example, pass "/posts" to call /wp/v2/sites/{siteId}/posts. ' +
			'For non-site endpoints, start the path with "!" (e.g., "!/me") to use an absolute path.',
		{
			method: Type.Enum( [ 'GET', 'POST', 'PUT', 'DELETE' ], {
				description: 'HTTP method for the request.',
			} ),
			path: Type.String( {
				description:
					'API path relative to /sites/{siteId}/, e.g. "/posts", "/posts/123", "/templates", "/template-parts". ' +
					'Prefix with "!" to use an absolute path (e.g. "!/me").',
			} ),
			query: Type.Optional(
				Type.Record( Type.String(), Type.Unknown(), {
					description:
						'Query parameters as key-value pairs, e.g. { "per_page": 20, "status": "publish" }.',
				} )
			),
			body: Type.Optional(
				Type.Record( Type.String(), Type.Unknown(), {
					description: 'Request body for POST/PUT requests as key-value pairs.',
				} )
			),
			bodyFile: Type.Optional(
				Type.String( {
					description: `Optional full request body file for POST/PUT requests. The file must be valid JSON object stored under ${ WPCOM_REQUEST_BODY_FILES_RELATIVE_DIR }, and it becomes the entire REST body. Use this for endpoints such as global styles that expect nested JSON objects. Do not combine bodyFile with body or bodyFiles.`,
				} )
			),
			bodyFiles: Type.Optional(
				Type.Record( Type.String(), Type.String(), {
					description:
						`Optional file-backed string body fields for POST/PUT requests. Keys must be top-level REST body field names like "content"; do not use filenames, file extensions, nested fields, dots, slashes, or JSON paths as keys. Values must be relative paths under ${ WPCOM_REQUEST_BODY_FILES_RELATIVE_DIR }. ` +
						`Example: { "content": "${ WPCOM_REQUEST_BODY_FILES_RELATIVE_DIR }/home.html" }. Use this for large generated strings instead of inlining them in body.`,
				} )
			),
			apiNamespace: Type.Optional(
				Type.String( {
					description:
						'API namespace. Defaults to "wp/v2" (WordPress REST API). ' +
						'Set to "wpcom/v2" for WordPress.com v2 endpoints, or omit/leave empty to fall back to WP.com REST API v1.1. ' +
						'Use wp/v2 for standard WordPress resources (posts, pages, templates, media, users, etc.). ' +
						'Use WP.com v1.1 (set apiNamespace to "") for WP.com-specific endpoints like /plugins, /themes/mine.',
				} )
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
						if ( args.bodyFile || args.bodyFiles ) {
							throw new Error(
								'bodyFile and bodyFiles can only be used with POST or PUT requests.'
							);
						}
						result = await wpcom.req.get< ApiResponse >( fullPath, queryParams );
						break;
					case 'POST':
						result = await wpcom.req.post< ApiResponse >(
							fullPath,
							queryParams,
							await resolveRequestBody(
								'wpcom_request',
								args.body,
								args.bodyFile,
								args.bodyFiles,
								bodyFilesRoot
							)
						);
						break;
					case 'PUT':
						result = await wpcom.req.put< ApiResponse >(
							fullPath,
							queryParams,
							await resolveRequestBody(
								'wpcom_request',
								args.body,
								args.bodyFile,
								args.bodyFiles,
								bodyFilesRoot
							)
						);
						break;
					case 'DELETE':
						if ( args.bodyFile || args.bodyFiles ) {
							throw new Error(
								'bodyFile and bodyFiles can only be used with POST or PUT requests.'
							);
						}
						result = await wpcom.req.del< ApiResponse >( fullPath, queryParams );
						break;
				}

				const compacted = stripOversizedFields( result );
				return textResult( JSON.stringify( compacted ) );
			} catch ( error ) {
				throw new Error(
					`WP.com API request failed (${ args.method } ${ args.path }): ${ getErrorMessage(
						error
					) }`
				);
			}
		}
	);
}
