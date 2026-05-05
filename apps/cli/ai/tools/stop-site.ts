import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod/v4';
import { runCommand as runStopSiteCommand, Mode as StopMode } from 'cli/commands/site/stop';
import { errorResult, resolveSite, textResult } from './utils';

export const stopSiteTool = tool(
	'site_stop',
	'Stops a running WordPress site by name or path.',
	{
		nameOrPath: z.string().describe( 'The site name or file system path to the site' ),
	},
	async ( args ) => {
		try {
			const site = await resolveSite( args.nameOrPath );
			await runStopSiteCommand( StopMode.STOP_SINGLE_SITE, site.path, false );
			return textResult( `Site "${ site.name }" stopped.` );
		} catch ( error ) {
			return errorResult(
				`Failed to stop site: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);
