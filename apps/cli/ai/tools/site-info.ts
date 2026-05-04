import { Type } from 'typebox';
import { runCommand as runStatusCommand } from 'cli/commands/site/status';
import { defineTool } from './define-tool';
import { captureConsoleOutput, resolveSite, textResult } from './utils';

export const getSiteInfoTool = defineTool(
	'site_info',
	'Gets detailed information about a specific WordPress site by name or path, including its running status, URL, PHP version, and admin credentials.',
	{
		nameOrPath: Type.String( { description: 'The site name or file system path to the site' } ),
	},
	async ( args ) => {
		try {
			const site = await resolveSite( args.nameOrPath );
			const output = await captureConsoleOutput( () => runStatusCommand( site.path, 'json' ) );
			return textResult( output || 'No site info available.' );
		} catch ( error ) {
			throw new Error(
				`Failed to get site info: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);
