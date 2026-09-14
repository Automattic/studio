import { Type } from 'typebox';
import { runCommand as runDeleteSiteCommand } from 'cli/commands/site/delete';
import { Logger } from 'cli/logger';
import { defineTool } from './define-tool';
import { resolveSite, textResult } from './utils';

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
	async ( args, context ) => {
		try {
			const site = await resolveSite( args.nameOrPath );
			await runDeleteSiteCommand(
				site.path,
				args.deleteFiles ?? true,
				new Logger( { onProgress: context.onProgress } )
			);
			return textResult( `Site "${ site.name }" deleted.` );
		} catch ( error ) {
			throw new Error(
				`Failed to delete site: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);
