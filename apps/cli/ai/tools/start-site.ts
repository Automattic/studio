import { z } from 'zod/v4';
import { runCommand as runStartSiteCommand } from 'cli/commands/site/start';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import { tool } from './define-tool';
import { errorResult, resolveSite, textResult } from './utils';

export const startSiteTool = tool(
	'site_start',
	'Starts a WordPress site by name or path. The site must already exist in Studio.',
	{
		nameOrPath: z.string().describe( 'The site name or file system path to the site' ),
	},
	async ( args ) => {
		try {
			const site = await resolveSite( args.nameOrPath );
			await runStartSiteCommand( site.path, true, true );
			return textResult( `Site "${ site.name }" started at ${ getSiteUrl( site ) }` );
		} catch ( error ) {
			return errorResult(
				`Failed to start site: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);
