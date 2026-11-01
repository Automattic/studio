import { Type } from 'typebox';
import { getHeadlessDetails } from '@studio/agent/node/headless';
import { defineTool, READ_ONLY } from './define-tool';
import { textResult } from './utils';

export const getSiteInfoTool = defineTool(
	'site_info',
	'Gets detailed information about a specific WordPress site by name or path, including its running status, URL, PHP version, and admin username. ' +
		'For a headless site it also reports the frontend project (folder, URL, framework) and the WordPress API endpoints the frontend reads.',
	{
		nameOrPath: Type.String( { description: 'The site name or file system path to the site' } ),
	},
	async ( args, context ) => {
		try {
			const site = await context.host.sites.resolve( args.nameOrPath );
			const status = await context.host.sites.status( site );
			const headless = getHeadlessDetails( site );
			return textResult(
				JSON.stringify(
					{
						...status,
						headless: Boolean( headless ),
						...( headless ? { frontend: headless } : {} ),
					},
					null,
					2
				)
			);
		} catch ( error ) {
			throw new Error(
				`Failed to get site info: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	},
	{
		promptSnippet:
			'Get details about a specific site (path, URL, admin username, running status; frontend and API endpoints for a headless site)',
		annotations: READ_ONLY,
	}
);
