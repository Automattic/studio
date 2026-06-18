import path from 'path';
import { DEFAULT_PHP_VERSION } from '@studio/common/constants';
import { Type } from 'typebox';
import { emitLocalSiteSelected } from 'cli/ai/site-selection';
import { runCommand as runCreateSiteCommand } from 'cli/commands/site/create';
import { getSiteUrl, getWpAdminUrl } from 'cli/lib/cli-config/sites';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';
import { defineTool } from './define-tool';
import { resolveSite, textResult } from './utils';

export const createSiteTool = defineTool(
	'site_create',
	'Creates a new local WordPress site with the latest WordPress version. Set `headless: true` to create a headless site instead — a static frontend (in frontend/public) backed by a WordPress REST API — when the user asks for a headless or decoupled site. Automatically sets up the site directory, installs WordPress, registers the site, and starts the server. Returns the site URL and credentials.',
	{
		name: Type.String( { description: 'The name for the new site (e.g., "My Coffee Shop")' } ),
		headless: Type.Optional(
			Type.Boolean( {
				description:
					'When true, create a headless site: a static frontend served to visitors, backed by a WordPress install used as a REST API. Use only when the user explicitly asks for a headless or decoupled site. Defaults to false (standard WordPress site).',
			} )
		),
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
				enableHttps: false,
				noStart: false,
				skipBrowser: true,
				skipLogDetails: true,
				headless: args.headless,
			} );

			const site = await resolveSite( args.name );
			const url = getSiteUrl( site );
			await emitLocalSiteSelected( {
				name: site.name,
				path: site.path,
				running: true,
				headless: site.headless,
			} );
			return {
				...textResult(
					JSON.stringify(
						{
							id: site.id,
							name: site.name,
							path: site.path,
							url,
							adminUrl: getWpAdminUrl( site ),
							username: 'admin',
							password: site.adminPassword,
							phpVersion: site.phpVersion,
							headless: Boolean( site.headless ),
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
