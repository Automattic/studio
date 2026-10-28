import { Type } from 'typebox';
import { studioHost } from '@studio/agent/node/host';
import { defineTool, LOCAL_CHANGE } from './define-tool';
import { resolveSite, textResult } from './utils';

export const startSiteTool = defineTool(
	'site_start',
	'Starts a WordPress site by name or path. The site must already exist in Studio.',
	{
		nameOrPath: Type.String( { description: 'The site name or file system path to the site' } ),
	},
	async ( args, context ) => {
		try {
			const site = await resolveSite( args.nameOrPath );
			await studioHost().sites.start( site, context.onProgress );
			return textResult( `Site "${ site.name }" started at ${ site.url }` );
		} catch ( error ) {
			throw new Error(
				`Failed to start site: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	},
	{ promptSnippet: 'Start a stopped site', annotations: LOCAL_CHANGE }
);
