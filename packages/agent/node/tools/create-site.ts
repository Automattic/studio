import path from 'path';
import { Type } from 'typebox';
import { defineTool, LOCAL_CHANGE } from './define-tool';
import { failsAs, slugify, textResult } from './utils';

export const createSiteTool = defineTool(
	'site_create',
	'Creates a new WordPress site with the latest WordPress version. Automatically sets up the site directory, installs WordPress, registers the site, and starts the server. Returns the site URL and credentials.',
	{
		name: Type.String( { description: 'The name for the new site (e.g., "My Coffee Shop")' } ),
	},
	( args, context ) =>
		failsAs( 'Failed to create site', async () => {
			const slug = slugify( args.name );
			if ( ! slug ) {
				throw new Error( 'Site name must contain at least one ASCII letter or digit (a-z, 0-9).' );
			}
			const host = context.host;
			await host.sites.create( args.name, path.join( host.sitesRoot, slug ), context.onProgress );

			const site = await context.host.sites.resolve( args.name );
			const url = site.url;
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
		} ),
	{
		annotations: LOCAL_CHANGE,
		siteParam: 'name',
		reportsChecks: true,
	}
);
