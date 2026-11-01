import path from 'path';
import { Type } from 'typebox';
import { getHeadlessDetails } from '@studio/agent/node/headless';
import { defineTool, LOCAL_CHANGE } from './define-tool';
import { textResult } from './utils';

export const createSiteTool = defineTool(
	'site_create',
	'Creates a new WordPress site with the latest WordPress version. Automatically sets up the site directory, installs WordPress, registers the site, and starts the server. Returns the site URL and credentials. ' +
		'Pass `frontend` only when the user explicitly asks for a headless or decoupled site, or for a frontend in a JavaScript framework (Astro, Next.js): it creates the WordPress backend plus a frontend project Studio runs, and returns the frontend URL and folder.',
	{
		name: Type.String( { description: 'The name for the new site (e.g., "My Coffee Shop")' } ),
		frontend: Type.Optional(
			Type.Object(
				{
					framework: Type.Enum( [ 'static', 'astro', 'next' ], {
						description:
							'"static" (plain HTML/JS, no Node.js needed), "astro", or "next" (Next.js). Use the one the user names; "astro" when they name none.',
					} ),
					api: Type.Optional(
						Type.Enum( [ 'rest', 'graphql' ], {
							description:
								'The API the frontend reads content from. Defaults to "rest"; "graphql" installs WPGraphQL. Only when the user asks for GraphQL.',
						} )
					),
				},
				{ description: 'Only for a headless site the user explicitly asked for.' }
			)
		),
	},
	async ( args, context ) => {
		try {
			const slug = args.name
				.toLowerCase()
				.replace( /[^a-z0-9]+/g, '-' )
				.replace( /^-|-$/g, '' );
			if ( ! slug ) {
				throw new Error( 'Site name must contain at least one ASCII letter or digit (a-z, 0-9).' );
			}
			const host = context.host;
			const sitePath = path.join( host.sitesRoot, slug );
			if ( args.frontend ) {
				await host.sites.create( args.name, sitePath, context.onProgress, {
					frontend: args.frontend,
				} );
			} else {
				await host.sites.create( args.name, sitePath, context.onProgress );
			}

			const site = await context.host.sites.resolve( args.name );
			const url = site.url;
			const headless = getHeadlessDetails( site );
			await context.host.selectSite?.( {
				id: site.id,
				name: site.name,
				path: site.path,
				running: true,
			} );
			return {
				...textResult(
					JSON.stringify(
						{
							id: site.id,
							name: site.name,
							path: site.path,
							url,
							adminUrl: `${ url }/wp-admin`,
							username: 'admin',
							password: site.adminPassword,
							phpVersion: site.phpVersion,
							...( headless ? { headless: true, ...headless } : {} ),
						},
						null,
						2
					)
				),
				studioArtifacts: [
					{
						type: 'site-preview',
						widgetProps: {
							path: '/',
							siteId: site.id,
							siteName: site.name,
							sitePath: site.path,
							url: headless?.frontendUrl ?? url,
							...( headless
								? { target: 'frontend', frontendUrl: headless.frontendUrl, wordpressUrl: url }
								: {} ),
						},
					},
				],
			};
		} catch ( error ) {
			throw new Error(
				`Failed to create site: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	},
	{
		promptSnippet:
			'Create a new WordPress site (name only — handles everything automatically); `frontend` makes it headless, only when the user asks for that',
		annotations: LOCAL_CHANGE,
	}
);
