import { Type } from 'typebox';
import { runCommand as runDeleteSiteCommand } from 'cli/commands/site/delete';
import { defineTool } from './define-tool';
import { resolveSite, textResult } from './utils';

export const deleteSiteTool = defineTool(
	'site_delete',
	'Deletes a WordPress site by name or path. Removes the site from Studio; site files are kept on disk unless deleteFiles is set. Requires the user to confirm before it runs.',
	{
		nameOrPath: Type.String( { description: 'The site name or file system path to the site' } ),
		deleteFiles: Type.Optional(
			Type.Boolean( {
				description:
					'Move site files to trash. Defaults to false (files are kept). Only set true when the user explicitly asked for the files to be deleted.',
			} )
		),
	},
	async ( args ) => {
		try {
			const site = await resolveSite( args.nameOrPath );
			await runDeleteSiteCommand( site.path, args.deleteFiles ?? false );
			return textResult( `Site "${ site.name }" deleted.` );
		} catch ( error ) {
			throw new Error(
				`Failed to delete site: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);
