import path from 'path';
import { Type } from 'typebox';
import { studioHost } from '@studio/agent/node/host';
import { emitLocalSiteSelected } from '@studio/agent/node/site-selection';
import { defineTool, LOCAL_CHANGE } from './define-tool';
import { resolveSite, textResult } from './utils';

export const createSiteTool = defineTool(
	'site_create',
	'Creates a new WordPress site with the latest WordPress version. Automatically sets up the site directory, installs WordPress, registers the site, and starts the server. Returns the site URL and credentials.',
	{
		name: Type.String( { description: 'The name for the new site (e.g., "My Coffee Shop")' } ),
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
			const host = studioHost();
			await host.sites.create( args.name, path.join( host.sitesRoot, slug ), context.onProgress );

			const site = await resolveSite( args.name );
			const url = site.url;
			await emitLocalSiteSelected( {
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
							url,
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
		promptSnippet: 'Create a new WordPress site (name only — handles everything automatically)',
		annotations: LOCAL_CHANGE,
	}
);
