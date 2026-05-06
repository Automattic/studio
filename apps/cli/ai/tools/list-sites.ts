import { runCommand as runListSitesCommand } from 'cli/commands/site/list';
import { defineTool } from './define-tool';
import { captureConsoleOutput, textResult } from './utils';

export const listSitesTool = defineTool(
	'site_list',
	'Lists all WordPress sites managed by Studio with their name, path, URL, and running status.',
	{},
	async () => {
		try {
			const output = await captureConsoleOutput( () => runListSitesCommand( 'json' ) );
			return textResult( output || 'No sites found.' );
		} catch ( error ) {
			throw new Error(
				`Failed to list sites: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);
