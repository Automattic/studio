import { Type } from 'typebox';
import { defineTool, READ_ONLY } from './define-tool';
import { textResult } from './utils';

export const getSiteInfoTool = defineTool(
	'site_info',
	'Gets detailed information about a specific WordPress site by name or path, including its running status, URL, PHP version, and admin username.',
	{
		nameOrPath: Type.String( { description: 'The site name or file system path to the site' } ),
	},
	async ( args, context ) => {
		try {
			const site = await context.host.sites.resolve( args.nameOrPath );
			return textResult( JSON.stringify( await context.host.sites.status( site ), null, 2 ) );
		} catch ( error ) {
			throw new Error(
				`Failed to get site info: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	},
	{
		promptSnippet: 'Get details about a specific site (path, URL, admin username, running status)',
		annotations: READ_ONLY,
	}
);
