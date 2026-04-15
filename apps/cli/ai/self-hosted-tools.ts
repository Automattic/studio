import { tool } from '@anthropic-ai/claude-agent-sdk';
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

/**
 * Creates a WordPress REST API tool for managing a self-hosted WordPress site.
 * Uses Application Passwords (Basic Auth) to authenticate directly with the site's REST API.
 */
export function createSelfHostedToolDefinitions(
	siteUrl: string,
	username: string,
	appPassword: string
) {
	const basicAuth = Buffer.from( `${ username }:${ appPassword }` ).toString( 'base64' );
	const baseUrl = siteUrl.replace( /\/+$/, '' );

	const wpRequestTool = tool(
		'wp_request',
		`Makes a request to the WordPress REST API (wp/v2) for the self-hosted site at ${ baseUrl }. ` +
			'Use this to manage posts, pages, templates, template parts, media, plugins, themes, settings, and any other site resource. ' +
			'The path is relative to /wp/v2/ — for example, pass "/posts" to call /wp-json/wp/v2/posts.',
		{
			method: z
				.enum( [ 'GET', 'POST', 'PUT', 'DELETE' ] )
				.describe( 'HTTP method for the request.' ),
			path: z
				.string()
				.describe(
					'API path relative to /wp/v2/, e.g. "/posts", "/posts/123", "/templates", "/template-parts".'
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
		},
		async ( args ) => {
			try {
				const relativePath = args.path.startsWith( '/' ) ? args.path : `/${ args.path }`;
				const url = new URL( `${ baseUrl }/wp-json/wp/v2${ relativePath }` );

				if ( args.query ) {
					for ( const [ key, value ] of Object.entries( args.query ) ) {
						if ( value !== undefined && value !== null ) {
							url.searchParams.set( key, String( value ) );
						}
					}
				}

				const headers: Record< string, string > = {
					Authorization: `Basic ${ basicAuth }`,
					'Content-Type': 'application/json',
				};

				const fetchOptions: RequestInit = {
					method: args.method,
					headers,
				};

				if ( ( args.method === 'POST' || args.method === 'PUT' ) && args.body ) {
					fetchOptions.body = JSON.stringify( args.body );
				}

				const response = await fetch( url.toString(), fetchOptions );

				if ( ! response.ok ) {
					const errorBody = await response.text();
					return errorResult(
						`REST API request failed (${ args.method } ${ args.path }): ${ response.status } ${ response.statusText }\n${ errorBody }`
					);
				}

				const result = await response.json();
				return textResult( JSON.stringify( result ) );
			} catch ( error ) {
				return errorResult(
					`REST API request failed (${ args.method } ${ args.path }): ${ getErrorMessage( error ) }`
				);
			}
		}
	);

	return [ wpRequestTool ];
}
