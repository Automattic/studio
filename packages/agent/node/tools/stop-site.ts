import { Type } from 'typebox';
import { studioHost } from '@studio/agent/node/host';
import { defineTool, LOCAL_CHANGE } from './define-tool';
import { resolveSite, textResult } from './utils';

export const stopSiteTool = defineTool(
	'site_stop',
	'Stops a running WordPress site by name or path.',
	{
		nameOrPath: Type.String( { description: 'The site name or file system path to the site' } ),
	},
	async ( args, context ) => {
		try {
			const site = await resolveSite( args.nameOrPath );
			await studioHost().sites.stop( site, context.onProgress );
			return textResult( `Site "${ site.name }" stopped.` );
		} catch ( error ) {
			throw new Error(
				`Failed to stop site: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	},
	{ promptSnippet: 'Stop a running site', annotations: LOCAL_CHANGE }
);
