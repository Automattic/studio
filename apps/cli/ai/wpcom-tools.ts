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

function jsonResult( data: unknown ) {
	return textResult( JSON.stringify( data, null, 2 ) );
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
 * Creates WP.com REST API tool definitions for managing a remote WordPress.com site.
 * The wpcom client is created once and captured via closure by all tool handlers.
 */
export function createWpcomToolDefinitions( token: string, siteId: number ) {
	const wpcom = wpcomFactory( token, wpcomXhrRequest );

	const getPostsTool = tool(
		'wpcom_get_posts',
		'Lists posts or pages on the WordPress.com site. Returns ID, title, status, type, date, and URL for each item.',
		{
			type: z
				.enum( [ 'post', 'page', 'any' ] )
				.optional()
				.describe( 'Post type to filter by. Defaults to "post".' ),
			status: z
				.enum( [ 'publish', 'draft', 'trash', 'any' ] )
				.optional()
				.describe( 'Post status to filter by. Defaults to "publish".' ),
			number: z.number().optional().describe( 'Number of posts to return. Defaults to 20.' ),
			search: z.string().optional().describe( 'Search query to filter posts.' ),
		},
		async ( args ) => {
			try {
				const query: Record< string, unknown > = {
					number: args.number ?? 20,
					fields: 'ID,title,status,type,date,URL,slug',
				};
				if ( args.type && args.type !== 'any' ) {
					query.type = args.type;
				}
				if ( args.status ) {
					query.status = args.status;
				}
				if ( args.search ) {
					query.search = args.search;
				}

				const result = await wpcom.req.get< ApiResponse >( `/sites/${ siteId }/posts`, query );
				const posts = ( result.posts ?? [] ).map(
					( p: {
						ID: number;
						title: string;
						status: string;
						type: string;
						date: string;
						URL: string;
						slug: string;
					} ) => ( {
						ID: p.ID,
						title: p.title,
						status: p.status,
						type: p.type,
						date: p.date,
						URL: p.URL,
						slug: p.slug,
					} )
				);
				return jsonResult( { found: result.found, posts } );
			} catch ( error ) {
				return errorResult( `Failed to list posts: ${ getErrorMessage( error ) }` );
			}
		}
	);

	const getPostTool = tool(
		'wpcom_get_post',
		'Gets a single post or page by ID, including its full content.',
		{
			post_id: z.number().describe( 'The post ID.' ),
		},
		async ( args ) => {
			try {
				const result = await wpcom.req.get< ApiResponse >(
					`/sites/${ siteId }/posts/${ args.post_id }`
				);
				return jsonResult( {
					ID: result.ID,
					title: result.title,
					content: result.content,
					excerpt: result.excerpt,
					status: result.status,
					type: result.type,
					date: result.date,
					URL: result.URL,
					slug: result.slug,
					featured_image: result.featured_image,
				} );
			} catch ( error ) {
				return errorResult( `Failed to get post: ${ getErrorMessage( error ) }` );
			}
		}
	);

	const createPostTool = tool(
		'wpcom_create_post',
		'Creates a new post or page on the WordPress.com site.',
		{
			title: z.string().describe( 'The post title.' ),
			content: z.string().optional().describe( 'The post content (HTML/block markup).' ),
			status: z
				.enum( [ 'publish', 'draft', 'private' ] )
				.optional()
				.describe( 'Post status. Defaults to "draft".' ),
			type: z.enum( [ 'post', 'page' ] ).optional().describe( 'Post type. Defaults to "post".' ),
			excerpt: z.string().optional().describe( 'The post excerpt.' ),
			slug: z.string().optional().describe( 'URL slug for the post.' ),
			featured_image: z.string().optional().describe( 'URL of the featured image.' ),
		},
		async ( args ) => {
			try {
				const body: Record< string, unknown > = {
					title: args.title,
					status: args.status ?? 'draft',
					type: args.type ?? 'post',
				};
				if ( args.content !== undefined ) {
					body.content = args.content;
				}
				if ( args.excerpt !== undefined ) {
					body.excerpt = args.excerpt;
				}
				if ( args.slug !== undefined ) {
					body.slug = args.slug;
				}
				if ( args.featured_image !== undefined ) {
					body.featured_image = args.featured_image;
				}

				const result = await wpcom.req.post< ApiResponse >(
					`/sites/${ siteId }/posts/new`,
					{},
					body
				);
				return jsonResult( {
					ID: result.ID,
					title: result.title,
					status: result.status,
					type: result.type,
					URL: result.URL,
					slug: result.slug,
				} );
			} catch ( error ) {
				return errorResult( `Failed to create post: ${ getErrorMessage( error ) }` );
			}
		}
	);

	const updatePostTool = tool(
		'wpcom_update_post',
		'Updates an existing post or page on the WordPress.com site.',
		{
			post_id: z.number().describe( 'The post ID to update.' ),
			title: z.string().optional().describe( 'New title.' ),
			content: z.string().optional().describe( 'New content (HTML/block markup).' ),
			status: z
				.enum( [ 'publish', 'draft', 'private', 'trash' ] )
				.optional()
				.describe( 'New status.' ),
			excerpt: z.string().optional().describe( 'New excerpt.' ),
			slug: z.string().optional().describe( 'New URL slug.' ),
			featured_image: z.string().optional().describe( 'URL of the new featured image.' ),
		},
		async ( args ) => {
			try {
				const body: Record< string, unknown > = {};
				if ( args.title !== undefined ) {
					body.title = args.title;
				}
				if ( args.content !== undefined ) {
					body.content = args.content;
				}
				if ( args.status !== undefined ) {
					body.status = args.status;
				}
				if ( args.excerpt !== undefined ) {
					body.excerpt = args.excerpt;
				}
				if ( args.slug !== undefined ) {
					body.slug = args.slug;
				}
				if ( args.featured_image !== undefined ) {
					body.featured_image = args.featured_image;
				}

				const result = await wpcom.req.post< ApiResponse >(
					`/sites/${ siteId }/posts/${ args.post_id }`,
					{},
					body
				);
				return jsonResult( {
					ID: result.ID,
					title: result.title,
					status: result.status,
					type: result.type,
					URL: result.URL,
					slug: result.slug,
				} );
			} catch ( error ) {
				return errorResult( `Failed to update post: ${ getErrorMessage( error ) }` );
			}
		}
	);

	const deletePostTool = tool(
		'wpcom_delete_post',
		'Deletes a post or page on the WordPress.com site.',
		{
			post_id: z.number().describe( 'The post ID to delete.' ),
		},
		async ( args ) => {
			try {
				await wpcom.req.post< ApiResponse >( `/sites/${ siteId }/posts/${ args.post_id }/delete` );
				return textResult( `Post ${ args.post_id } deleted.` );
			} catch ( error ) {
				return errorResult( `Failed to delete post: ${ getErrorMessage( error ) }` );
			}
		}
	);

	const listMediaTool = tool(
		'wpcom_list_media',
		'Lists media items on the WordPress.com site.',
		{
			number: z.number().optional().describe( 'Number of media items to return. Defaults to 20.' ),
			mime_type: z
				.string()
				.optional()
				.describe( 'Filter by MIME type, e.g. "image" or "image/jpeg".' ),
		},
		async ( args ) => {
			try {
				const query: Record< string, unknown > = {
					number: args.number ?? 20,
					fields: 'ID,URL,title,mime_type,date',
				};
				if ( args.mime_type ) {
					query.mime_type = args.mime_type;
				}

				const result = await wpcom.req.get< ApiResponse >( `/sites/${ siteId }/media`, query );
				const media = ( result.media ?? [] ).map(
					( m: { ID: number; URL: string; title: string; mime_type: string; date: string } ) => ( {
						ID: m.ID,
						URL: m.URL,
						title: m.title,
						mime_type: m.mime_type,
						date: m.date,
					} )
				);
				return jsonResult( { found: result.found, media } );
			} catch ( error ) {
				return errorResult( `Failed to list media: ${ getErrorMessage( error ) }` );
			}
		}
	);

	const uploadMediaTool = tool(
		'wpcom_upload_media',
		'Uploads media to the WordPress.com site from one or more URLs.',
		{
			urls: z.array( z.string() ).describe( 'Array of URLs to upload as media.' ),
		},
		async ( args ) => {
			try {
				const result = await wpcom.req.post< ApiResponse >(
					`/sites/${ siteId }/media/new`,
					{},
					{ media_urls: args.urls }
				);
				const media = ( result.media ?? [] ).map(
					( m: { ID: number; URL: string; title: string } ) => ( {
						ID: m.ID,
						URL: m.URL,
						title: m.title,
					} )
				);
				return jsonResult( { media } );
			} catch ( error ) {
				return errorResult( `Failed to upload media: ${ getErrorMessage( error ) }` );
			}
		}
	);

	const listPluginsTool = tool(
		'wpcom_list_plugins',
		'Lists installed plugins on the WordPress.com site.',
		{},
		async () => {
			try {
				const result = await wpcom.req.get< ApiResponse >( `/sites/${ siteId }/plugins` );
				const plugins = ( result.plugins ?? result ?? [] ).map(
					( p: { slug: string; name: string; active: boolean; version: string } ) => ( {
						slug: p.slug,
						name: p.name,
						active: p.active,
						version: p.version,
					} )
				);
				return jsonResult( { plugins } );
			} catch ( error ) {
				return errorResult( `Failed to list plugins: ${ getErrorMessage( error ) }` );
			}
		}
	);

	const installPluginTool = tool(
		'wpcom_install_plugin',
		'Installs a plugin on the WordPress.com site from the WordPress.org plugin directory.',
		{
			slug: z.string().describe( 'The plugin slug from wordpress.org (e.g. "woocommerce").' ),
		},
		async ( args ) => {
			try {
				const result = await wpcom.req.post< ApiResponse >(
					`/sites/${ siteId }/plugins/${ args.slug }/install`,
					{}
				);
				return jsonResult( {
					slug: result.slug ?? args.slug,
					name: result.name,
					active: result.active,
					version: result.version,
				} );
			} catch ( error ) {
				return errorResult( `Failed to install plugin: ${ getErrorMessage( error ) }` );
			}
		}
	);

	const activatePluginTool = tool(
		'wpcom_activate_plugin',
		'Activates an installed plugin on the WordPress.com site.',
		{
			slug: z.string().describe( 'The plugin slug to activate.' ),
		},
		async ( args ) => {
			try {
				const result = await wpcom.req.post< ApiResponse >(
					`/sites/${ siteId }/plugins/${ args.slug }`,
					{},
					{ active: true }
				);
				return textResult( `Plugin "${ result.name ?? args.slug }" activated.` );
			} catch ( error ) {
				return errorResult( `Failed to activate plugin: ${ getErrorMessage( error ) }` );
			}
		}
	);

	const deactivatePluginTool = tool(
		'wpcom_deactivate_plugin',
		'Deactivates a plugin on the WordPress.com site.',
		{
			slug: z.string().describe( 'The plugin slug to deactivate.' ),
		},
		async ( args ) => {
			try {
				const result = await wpcom.req.post< ApiResponse >(
					`/sites/${ siteId }/plugins/${ args.slug }`,
					{},
					{ active: false }
				);
				return textResult( `Plugin "${ result.name ?? args.slug }" deactivated.` );
			} catch ( error ) {
				return errorResult( `Failed to deactivate plugin: ${ getErrorMessage( error ) }` );
			}
		}
	);

	const listThemesTool = tool(
		'wpcom_list_themes',
		'Lists available themes on the WordPress.com site.',
		{},
		async () => {
			try {
				const result = await wpcom.req.get< ApiResponse >( `/sites/${ siteId }/themes` );
				const themes = ( result.themes ?? [] ).map(
					( t: { id: string; name: string; active: boolean; version: string } ) => ( {
						id: t.id,
						name: t.name,
						active: t.active,
						version: t.version,
					} )
				);
				return jsonResult( { themes } );
			} catch ( error ) {
				return errorResult( `Failed to list themes: ${ getErrorMessage( error ) }` );
			}
		}
	);

	const activateThemeTool = tool(
		'wpcom_activate_theme',
		'Activates a theme on the WordPress.com site.',
		{
			theme: z.string().describe( 'The theme slug to activate (e.g. "twentytwentyfive").' ),
		},
		async ( args ) => {
			try {
				const result = await wpcom.req.post< ApiResponse >(
					`/sites/${ siteId }/themes/mine`,
					{},
					{ theme: args.theme }
				);
				return textResult( `Theme "${ result.name ?? args.theme }" activated.` );
			} catch ( error ) {
				return errorResult( `Failed to activate theme: ${ getErrorMessage( error ) }` );
			}
		}
	);

	const getSiteInfoTool = tool(
		'wpcom_get_site_info',
		'Gets detailed information about the WordPress.com site including name, URL, description, plan, and settings.',
		{},
		async () => {
			try {
				const result = await wpcom.req.get< ApiResponse >( `/sites/${ siteId }` );
				return jsonResult( {
					ID: result.ID,
					name: result.name,
					description: result.description,
					URL: result.URL,
					is_private: result.is_private,
					lang: result.lang,
					plan: result.plan,
					options: {
						blogname: result.options?.blogname,
						blogdescription: result.options?.blogdescription,
						timezone_string: result.options?.timezone_string,
						admin_url: result.options?.admin_url,
						software_version: result.options?.software_version,
						default_post_format: result.options?.default_post_format,
					},
				} );
			} catch ( error ) {
				return errorResult( `Failed to get site info: ${ getErrorMessage( error ) }` );
			}
		}
	);

	const updateSettingsTool = tool(
		'wpcom_update_settings',
		'Updates site settings on the WordPress.com site. Common settings: blogname, blogdescription, lang, default_post_format, default_category.',
		{
			settings: z
				.record( z.string(), z.unknown() )
				.describe(
					'Object of setting key-value pairs to update, e.g. { "blogname": "My Site", "blogdescription": "A great site" }.'
				),
		},
		async ( args ) => {
			try {
				const result = await wpcom.req.post< ApiResponse >(
					`/sites/${ siteId }/settings`,
					{},
					args.settings
				);
				return jsonResult( { updated: result.updated } );
			} catch ( error ) {
				return errorResult( `Failed to update settings: ${ getErrorMessage( error ) }` );
			}
		}
	);

	return [
		getPostsTool,
		getPostTool,
		createPostTool,
		updatePostTool,
		deletePostTool,
		listMediaTool,
		uploadMediaTool,
		listPluginsTool,
		installPluginTool,
		activatePluginTool,
		deactivatePluginTool,
		listThemesTool,
		activateThemeTool,
		getSiteInfoTool,
		updateSettingsTool,
	];
}
