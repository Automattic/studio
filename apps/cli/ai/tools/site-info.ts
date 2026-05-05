import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod/v4';
import { runCommand as runStatusCommand } from 'cli/commands/site/status';
import { captureConsoleOutput, errorResult, resolveSite, textResult } from './utils';

export const getSiteInfoTool = tool(
	'site_info',
	'Gets detailed information about a specific WordPress site by name or path, including its running status, URL, PHP version, and admin credentials.',
	{
		nameOrPath: z.string().describe( 'The site name or file system path to the site' ),
	},
	async ( args ) => {
		try {
			const site = await resolveSite( args.nameOrPath );
			const output = await captureConsoleOutput( () => runStatusCommand( site.path, 'json' ) );
			return textResult( output || 'No site info available.' );
		} catch ( error ) {
			return errorResult(
				`Failed to get site info: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);
