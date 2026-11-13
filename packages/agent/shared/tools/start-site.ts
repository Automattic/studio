import { Type } from 'typebox';
import { defineTool, LOCAL_CHANGE } from './define-tool';
import { failsAs, textResult } from './utils';

export const startSiteTool = defineTool(
	'site_start',
	'Starts a WordPress site by name or path. The site must already exist in Studio.',
	{
		nameOrPath: Type.String( { description: 'The site name or file system path to the site' } ),
	},
	( args, context ) =>
		failsAs( 'Failed to start site', async () => {
			const site = await context.host.sites.resolve( args.nameOrPath );
			await context.host.sites.start( site, context.onProgress );
			return textResult( `Site "${ site.name }" started at ${ site.url }` );
		} ),
	{ annotations: LOCAL_CHANGE, reportsChecks: true }
);
