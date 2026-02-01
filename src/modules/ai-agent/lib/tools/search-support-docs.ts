import https from 'https';
import { type BaseTool, successResult, errorResult } from './base-tool';
import type { ToolDefinition, ToolResult } from '../../types';

const WORDPRESS_SUPPORT_SITE_ID = '33534099';
const API_BASE = 'https://public-api.wordpress.com/rest/v1.3';

interface SearchResult {
	fields: {
		date: string;
		'permalink.url.raw': string;
		'tag.name.default'?: string[];
		'category.name.default'?: string[];
		post_type: string;
	};
	highlight: {
		title?: string[];
		content?: string[];
	};
}

interface SearchResponse {
	results: SearchResult[];
	total: number;
}

const definition: ToolDefinition = {
	name: 'search_support_docs',
	description: `Search the WordPress.com developer documentation for help articles, tutorials, and guides.

Use this tool to find official documentation about:
- WordPress features and settings
- Theme development
- Plugin development
- WordPress.com specific features
- Troubleshooting guides

Returns relevant documentation links with snippets from matching content.`,
	input_schema: {
		type: 'object' as const,
		properties: {
			query: {
				type: 'string',
				description: 'The search query to find relevant documentation',
			},
			limit: {
				type: 'number',
				description: 'Maximum number of results to return (1-10, default: 5)',
			},
		},
		required: [ 'query' ],
	},
};

function makeRequest( url: string ): Promise< SearchResponse > {
	return new Promise( ( resolve, reject ) => {
		const request = https.get(
			url,
			{
				headers: {
					Accept: '*/*',
					'User-Agent': 'Studio-AI-Agent/1.0',
					Origin: 'https://developer.wordpress.com',
					Referer: 'https://developer.wordpress.com/',
				},
			},
			( response ) => {
				let data = '';

				response.on( 'data', ( chunk ) => {
					data += chunk;
				} );

				response.on( 'end', () => {
					try {
						const parsed = JSON.parse( data );
						resolve( parsed );
					} catch ( e ) {
						reject( new Error( 'Failed to parse search response' ) );
					}
				} );
			}
		);

		request.on( 'error', ( error ) => {
			reject( error );
		} );

		request.setTimeout( 10000, () => {
			request.destroy();
			reject( new Error( 'Request timeout' ) );
		} );
	} );
}

function stripHtmlTags( html: string ): string {
	return html
		.replace( /<[^>]*>/g, '' )
		.replace( /&nbsp;/g, ' ' )
		.replace( /&amp;/g, '&' )
		.replace( /&lt;/g, '<' )
		.replace( /&gt;/g, '>' )
		.replace( /&quot;/g, '"' )
		.replace( /&#39;/g, "'" )
		.trim();
}

async function execute( input: Record< string, unknown >, _siteId: string ): Promise< ToolResult > {
	const query = input.query as string;
	let limit = ( input.limit as number ) || 5;

	if ( ! query || typeof query !== 'string' ) {
		return errorResult( 'Search query is required' );
	}

	// Clamp limit
	limit = Math.max( 1, Math.min( 10, limit ) );

	try {
		const params = new URLSearchParams( {
			'fields[0]': 'date',
			'fields[1]': 'permalink.url.raw',
			'fields[2]': 'tag.name.default',
			'fields[3]': 'category.name.default',
			'fields[4]': 'post_type',
			'highlight_fields[0]': 'title',
			'highlight_fields[1]': 'content',
			'filter[bool][must][0][bool][should][0][term][post_type]': 'documentation',
			query: query,
			sort: 'score_default',
			size: String( limit ),
		} );

		const url = `${ API_BASE }/sites/${ WORDPRESS_SUPPORT_SITE_ID }/search?${ params.toString() }`;
		const response = await makeRequest( url );

		if ( ! response.results || response.results.length === 0 ) {
			return successResult(
				`No documentation found for "${ query }". Try different keywords or a more general search term.`
			);
		}

		const results = response.results.map( ( result, index ) => {
			const title = result.highlight?.title?.[ 0 ]
				? stripHtmlTags( result.highlight.title[ 0 ] )
				: 'Untitled';
			const url = result.fields[ 'permalink.url.raw' ] || '';
			const snippet = result.highlight?.content?.[ 0 ]
				? stripHtmlTags( result.highlight.content[ 0 ] ).substring( 0, 200 ) + '...'
				: '';

			return [
				`${ index + 1 }. **${ title }**`,
				snippet ? `   ${ snippet }` : '',
				`   URL: ${ url }`,
			]
				.filter( Boolean )
				.join( '\n' );
		} );

		return successResult(
			`Found ${ response.total } results for "${ query }":\n\n${ results.join( '\n\n' ) }`
		);
	} catch ( error ) {
		const errorMessage = error instanceof Error ? error.message : String( error );
		return errorResult( `Failed to search documentation: ${ errorMessage }` );
	}
}

export const searchSupportDocsTool: BaseTool = {
	definition,
	execute,
};
