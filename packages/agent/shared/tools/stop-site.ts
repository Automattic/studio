import { Type } from 'typebox';
import { defineTool, LOCAL_CHANGE } from './define-tool';
import { failsAs, textResult } from './utils';

export const stopSiteTool = defineTool(
	'site_stop',
	'Stops a running WordPress site by name or path.',
	{
		nameOrPath: Type.String( { description: 'The site name or file system path to the site' } ),
	},
	( args, context ) =>
		failsAs( 'Failed to stop site', async () => {
			const site = await context.host.sites.resolve( args.nameOrPath );
			await context.host.sites.stop( site, context.onProgress );
			return textResult( `Site "${ site.name }" stopped.` );
		} ),
	{ annotations: LOCAL_CHANGE }
);
