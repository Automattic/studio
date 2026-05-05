import path from 'path';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { DEFAULT_PHP_VERSION } from '@studio/common/constants';
import { z } from 'zod/v4';
import { runCommand as runCreateSiteCommand } from 'cli/commands/site/create';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';
import { errorResult, resolveSite, textResult } from './utils';

export const createSiteTool = tool(
	'site_create',
	'Creates a new WordPress site with the latest WordPress version. Automatically sets up the site directory, installs WordPress, registers the site, and starts the server. Returns the site URL and credentials.',
	{
		name: z.string().describe( 'The name for the new site (e.g., "My Coffee Shop")' ),
	},
	async ( args ) => {
		try {
			const slug = args.name
				.toLowerCase()
				.replace( /[^a-z0-9]+/g, '-' )
				.replace( /^-|-$/g, '' );
			if ( ! slug ) {
				return errorResult(
					'Site name must contain at least one ASCII letter or digit (a-z, 0-9).'
				);
			}
			const sitePath = path.join( STUDIO_SITES_ROOT, slug );

			await runCreateSiteCommand( sitePath, {
				name: args.name,
				wpVersion: 'latest',
				phpVersion: DEFAULT_PHP_VERSION,
				enableHttps: false,
				noStart: false,
				skipBrowser: true,
				skipLogDetails: true,
			} );

			const site = await resolveSite( args.name );
			const url = getSiteUrl( site );
			return textResult(
				JSON.stringify(
					{
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
			);
		} catch ( error ) {
			return errorResult(
				`Failed to create site: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);
