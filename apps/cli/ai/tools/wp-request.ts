import { getConfigDirectory } from '@studio/common/lib/well-known-paths';
import { Type } from 'typebox';
import { defineTool } from './define-tool';
import { REQUEST_BODY_FILES_RELATIVE_DIR, resolveRequestBody } from './request-body-files';
import { textResult } from './utils';

export const WP_REQUEST_BODY_FILES_RELATIVE_DIR = REQUEST_BODY_FILES_RELATIVE_DIR;

interface WpRequestToolOptions {
	bodyFilesRoot?: string;
	fetchImplementation?: typeof fetch;
}

function getErrorMessage( error: unknown ): string {
	if ( error instanceof Error ) {
		return error.message;
	}
	return String( error );
}

/**
 * Creates a generic WordPress REST API tool for managing a self-hosted
 * WordPress site. Authenticates directly against the site's REST API with an
 * Application Password (Basic Auth). Like wpcom_request, this is a single
 * flexible tool rather than one tool per endpoint — the AI agent determines
 * the correct endpoints based on its knowledge of the WordPress REST API.
 */
export function createWpRequestTool(
	siteUrl: string,
	username: string,
	appPassword: string,
	options: WpRequestToolOptions = {}
) {
	const basicAuth = Buffer.from( `${ username }:${ appPassword }` ).toString( 'base64' );
	const baseUrl = siteUrl.replace( /\/+$/, '' );
	const bodyFilesRoot = options.bodyFilesRoot ?? getConfigDirectory();
	const fetchImplementation = options.fetchImplementation ?? fetch;

	return defineTool(
		'wp_request',
		`Makes a request to the WordPress REST API for the self-hosted site at ${ baseUrl }. ` +
			'Defaults to the wp/v2 namespace. Use this to manage posts, pages, templates, template parts, ' +
			'media, plugins, themes, settings, and any other site resource. ' +
			'The path is relative to the namespace — for example, pass "/posts" to call /wp-json/wp/v2/posts.',
		{
			method: Type.Enum( [ 'GET', 'POST', 'PUT', 'DELETE' ], {
				description: 'HTTP method for the request.',
			} ),
			path: Type.String( {
				description:
					'API path relative to the namespace, e.g. "/posts", "/posts/123", "/templates", "/template-parts".',
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
					description: `Optional full request body file for POST/PUT requests. The file must be a valid JSON object stored under ${ WP_REQUEST_BODY_FILES_RELATIVE_DIR }, and it becomes the entire REST body. Use this for endpoints such as global styles that expect nested JSON objects. Do not combine bodyFile with body or bodyFiles.`,
				} )
			),
			bodyFiles: Type.Optional(
				Type.Record( Type.String(), Type.String(), {
					description:
						`Optional file-backed string body fields for POST/PUT requests. Keys must be top-level REST body field names like "content"; do not use filenames, file extensions, nested fields, dots, slashes, or JSON paths as keys. Values must be relative paths under ${ WP_REQUEST_BODY_FILES_RELATIVE_DIR }. ` +
						`Example: { "content": "${ WP_REQUEST_BODY_FILES_RELATIVE_DIR }/home.html" }. Use this for large generated strings instead of inlining them in body.`,
				} )
			),
			apiNamespace: Type.Optional(
				Type.String( {
					description:
						'REST API namespace. Defaults to "wp/v2" (WordPress REST API). ' +
						'Set to a plugin namespace such as "wc/v3" (WooCommerce) to call plugin-registered endpoints.',
				} )
			),
		},
		async ( args ) => {
			try {
				const apiNamespace = ( args.apiNamespace ?? 'wp/v2' ).replace( /^\/+|\/+$/g, '' );
				const relativePath = args.path.startsWith( '/' ) ? args.path : `/${ args.path }`;
				const url = new URL( `${ baseUrl }/wp-json/${ apiNamespace }${ relativePath }` );

				if ( args.query ) {
					for ( const [ key, value ] of Object.entries( args.query ) ) {
						if ( value !== undefined && value !== null ) {
							url.searchParams.set( key, String( value ) );
						}
					}
				}

				const fetchOptions: RequestInit = {
					method: args.method,
					headers: {
						Authorization: `Basic ${ basicAuth }`,
						'Content-Type': 'application/json',
					},
				};

				if ( args.method === 'POST' || args.method === 'PUT' ) {
					fetchOptions.body = JSON.stringify(
						await resolveRequestBody(
							'wp_request',
							args.body,
							args.bodyFile,
							args.bodyFiles,
							bodyFilesRoot
						)
					);
				} else if ( args.bodyFile || args.bodyFiles ) {
					throw new Error( 'bodyFile and bodyFiles can only be used with POST or PUT requests.' );
				}

				const response = await fetchImplementation( url.toString(), fetchOptions );

				if ( ! response.ok ) {
					const errorBody = await response.text();
					throw new Error( `${ response.status } ${ response.statusText }\n${ errorBody }` );
				}

				const result: unknown = await response.json();
				return textResult( JSON.stringify( result ) );
			} catch ( error ) {
				throw new Error(
					`WordPress REST API request failed (${ args.method } ${ args.path }): ${ getErrorMessage(
						error
					) }`
				);
			}
		}
	);
}
