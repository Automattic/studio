import path from 'path';
import { DEFAULT_PHP_VERSION } from '@studio/common/constants';
import { SITE_FILE_ACCESS_SITE_DIRECTORY } from '@studio/common/lib/site-file-access';
import { SITE_RUNTIME_NATIVE_PHP } from '@studio/common/lib/site-runtime';
import { Type } from 'typebox';
import { emitLocalSiteSelected } from 'cli/ai/site-selection';
import { runCommand as runCreateSiteCommand } from 'cli/commands/site/create';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';
import { defineTool } from './define-tool';
import { resolveSite, textResult } from './utils';

export const createSiteTool = defineTool(
	'site_create',
	'Creates a new WordPress site with the latest WordPress version. Automatically sets up the site directory, installs WordPress, registers the site, and starts the server. Returns the site URL and credentials.',
	{
		name: Type.String( { description: 'The name for the new site (e.g., "My Coffee Shop")' } ),
	},
	async ( args ) => {
		try {
			const slug = args.name
				.toLowerCase()
				.replace( /[^a-z0-9]+/g, '-' )
				.replace( /^-|-$/g, '' );
			if ( ! slug ) {
				throw new Error( 'Site name must contain at least one ASCII letter or digit (a-z, 0-9).' );
			}
			const sitePath = path.join( STUDIO_SITES_ROOT, slug );

			await runCreateSiteCommand( sitePath, {
				name: args.name,
				wpVersion: 'latest',
				phpVersion: DEFAULT_PHP_VERSION,
				runtime: SITE_RUNTIME_NATIVE_PHP,
				fileAccess: SITE_FILE_ACCESS_SITE_DIRECTORY,
				enableHttps: false,
				noStart: false,
				skipBrowser: true,
				skipLogDetails: true,
			} );

			const site = await resolveSite( args.name );
			const url = getSiteUrl( site );
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
	}
);
