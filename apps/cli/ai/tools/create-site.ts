import path from 'path';
import { DEFAULT_PHP_VERSION } from '@studio/common/constants';
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

			// Start the WordPress server on create (the default). The PHP-WASM server
			// boots fine in the SecEx sandbox — and booting it runs the WP install,
			// which creates the SQLite database, so the site is actually functional and
			// the agent can build real content (pages, posts, options). An earlier build
			// skipped the start in the sandbox on the assumption PHP-WASM couldn't boot
			// there; it can, and skipping it left sites with no database. Studio Web
			// still renders the preview client-side (browser Playground) rather than
			// serving from the sandbox. STUDIO_SKIP_SITE_START is an explicit escape
			// hatch for hosts where the server genuinely can't start.
			const skipStart =
				process.env.STUDIO_SKIP_SITE_START === '1' || process.env.STUDIO_SKIP_SITE_START === 'true';

			await runCreateSiteCommand( sitePath, {
				name: args.name,
				wpVersion: 'latest',
				phpVersion: DEFAULT_PHP_VERSION,
				enableHttps: false,
				noStart: skipStart,
				skipBrowser: true,
				skipLogDetails: true,
			} );

			const site = await resolveSite( args.name );
			const url = getSiteUrl( site );
			await emitLocalSiteSelected( {
				name: site.name,
				path: site.path,
				running: ! skipStart,
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
