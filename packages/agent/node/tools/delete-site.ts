import { Type } from 'typebox';
import { defineTool, LOCAL_OVERWRITE } from './define-tool';
import { failsAs, textResult } from './utils';

export const deleteSiteTool = defineTool(
	'site_delete',
	'Deletes a WordPress site by name or path. Removes the site from Studio and optionally moves site files to trash.',
	{
		nameOrPath: Type.String( { description: 'The site name or file system path to the site' } ),
		deleteFiles: Type.Optional(
			Type.Boolean( {
				description: 'Move site files to trash. Defaults to true. Set to false to keep files.',
			} )
		),
	},
	( args, context ) =>
		failsAs( 'Failed to delete site', async () => {
			const site = await context.host.sites.resolve( args.nameOrPath );
			await context.host.sites.delete( site, args.deleteFiles ?? true, context.onProgress );
			return textResult( `Site "${ site.name }" deleted.` );
		} ),
	{
		annotations: LOCAL_OVERWRITE,
	}
);
