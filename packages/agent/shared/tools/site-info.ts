import { Type } from 'typebox';
import { defineTool, READ_ONLY } from './define-tool';
import { failsAs, textResult } from './utils';

export const getSiteInfoTool = defineTool(
	'site_info',
	'Gets detailed information about a specific WordPress site by name or path, including its running status, URL, PHP version, admin username, and emailPath: the folder where WordPress Studio saves each email the site sends, as an .eml file.',
	{
		nameOrPath: Type.String( { description: 'The site name or file system path to the site' } ),
	},
	( args, context ) =>
		failsAs( 'Failed to get site info', async () => {
			const site = await context.host.sites.resolve( args.nameOrPath );
			return textResult( JSON.stringify( await context.host.sites.status( site ), null, 2 ) );
		} ),
	{
		annotations: READ_ONLY,
		reportsChecks: true,
	}
);
