import { Type } from 'typebox';
import { readAdminInventory } from '@studio/agent/shared/admin-inventory';
import { defineTool, READ_ONLY } from './define-tool';
import { textResult } from './utils';

export const inspectWpAdminTool = defineTool(
	'inspect_wp_admin',
	"Reads a site's real wp-admin as an administrator sees it: every menu item and submenu, with plugins' own, and every dashboard widget. " +
		'Each item has the `screen` a curated admin manifest refers to it by. Changes nothing.',
	{
		nameOrPath: Type.String( { description: 'The site name or file system path to the site' } ),
	},
	async ( args, context ) => {
		const site = await context.host.sites.resolve( args.nameOrPath );
		if ( ! ( await context.host.sites.isRunning( site ) ) ) {
			throw new Error( 'The site is not running. Start it with site_start first.' );
		}
		return textResult( JSON.stringify( await readAdminInventory( context.host, site ), null, 1 ) );
	},
	{
		annotations: READ_ONLY,
		promptSnippet: "Read a site's real wp-admin menu and dashboard widgets.",
	}
);
