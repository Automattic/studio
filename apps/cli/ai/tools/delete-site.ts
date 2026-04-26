import { z } from 'zod/v4';
import { runCommand as runDeleteSiteCommand } from 'cli/commands/site/delete';
import { tool } from './define-tool';
import { errorResult, resolveSite, textResult } from './utils';

export const deleteSiteTool = tool(
	'site_delete',
	'Deletes a WordPress site by name or path. Removes the site from Studio and optionally moves site files to trash.',
	{
		nameOrPath: z.string().describe( 'The site name or file system path to the site' ),
		deleteFiles: z
			.boolean()
			.optional()
			.describe( 'Move site files to trash. Defaults to true. Set to false to keep files.' ),
	},
	async ( args ) => {
		try {
			const site = await resolveSite( args.nameOrPath );
			await runDeleteSiteCommand( site.path, args.deleteFiles ?? true );
			return textResult( `Site "${ site.name }" deleted.` );
		} catch ( error ) {
			return errorResult(
				`Failed to delete site: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);
