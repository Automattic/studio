import { Type } from 'typebox';
import { defineTool, LOCAL_CHANGE } from './define-tool';
import { textResult } from './utils';

export const stopSiteTool = defineTool(
	'site_stop',
	'Stops a running WordPress site by name or path.',
	{
		nameOrPath: Type.String( { description: 'The site name or file system path to the site' } ),
	},
	async ( args, context ) => {
		try {
			const site = await context.host.sites.resolve( args.nameOrPath );
			await context.host.sites.stop( site, context.onProgress );
			return textResult( `Site "${ site.name }" stopped.` );
		} catch ( error ) {
			throw new Error(
				`Failed to stop site: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	},
	{ annotations: LOCAL_CHANGE }
);
