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
		`Makes a request to the WordPress.com REST API for site ${ siteId }. ` +
			'Use this to manage posts, pages, templates, media, plugins, themes, settings, and any other site resource. ' +
			'The path is relative to /sites/{siteId}/ — for example, pass "/posts" to call /sites/{siteId}/posts. ' +
			'For non-site endpoints, start the path with "!" (e.g., "!/me") to use an absolute path.',
		{
			method: z
				.enum( [ 'GET', 'POST', 'PUT', 'DELETE' ] )
				.describe( 'HTTP method for the request.' ),
			path: z
				.string()
				.describe(
					'API path relative to /sites/{siteId}/, e.g. "/posts", "/posts/123", "/themes/mine". ' +
						'Prefix with "!" to use an absolute path (e.g. "!/me").'
				),
			query: z
				.record( z.string(), z.unknown() )
				.optional()
				.describe(
					'Query parameters as key-value pairs, e.g. { "number": 20, "status": "publish" }.'
				),
			body: z
				.record( z.string(), z.unknown() )
				.optional()
				.describe( 'Request body for POST/PUT requests as key-value pairs.' ),
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

				let result: ApiResponse;
				switch ( args.method ) {
					case 'GET':
						result = await wpcom.req.get< ApiResponse >( fullPath, args.query ?? {} );
						break;
					case 'POST':
						result = await wpcom.req.post< ApiResponse >(
							fullPath,
							args.query ?? {},
							args.body ?? {}
						);
						break;
					case 'PUT':
						result = await wpcom.req.put< ApiResponse >(
							fullPath,
							args.query ?? {},
							args.body ?? {}
						);
						break;
					case 'DELETE':
						result = await wpcom.req.del< ApiResponse >( fullPath, args.query ?? {} );
						break;
				}

				return textResult( JSON.stringify( result, null, 2 ) );
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
