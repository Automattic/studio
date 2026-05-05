import { tool } from '@anthropic-ai/claude-agent-sdk';
import { runCommand as runListSitesCommand } from 'cli/commands/site/list';
import { captureConsoleOutput, errorResult, textResult } from './utils';

export const listSitesTool = tool(
	'site_list',
	'Lists all WordPress sites managed by Studio with their name, path, URL, and running status.',
	{},
	async () => {
		try {
			const output = await captureConsoleOutput( () => runListSitesCommand( 'json' ) );
			return textResult( output || 'No sites found.' );
		} catch ( error ) {
			return errorResult(
				`Failed to list sites: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);
