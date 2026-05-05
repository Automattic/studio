import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod/v4';
import { runCommand as runImportCommand } from 'cli/commands/import';
import { captureCommandOutput, errorResult, resolveSite, textResult } from './utils';

export const importSiteTool = tool(
	'site_import',
	'Imports a backup file into a local WordPress site. Supports .zip, .tar.gz, .sql, and .wpress formats. ' +
		'The site server will be stopped during import and restarted afterward if it was running.',
	{
		nameOrPath: z.string().describe( 'The local site name or file system path' ),
		importFile: z.string().describe( 'Absolute path to the backup file to import' ),
	},
	async ( args ) => {
		try {
			const site = await resolveSite( args.nameOrPath );

			const result = await captureCommandOutput( () =>
				runImportCommand( site.path, args.importFile )
			);
			const output = result.consoleOutput || result.progressOutput || 'Import completed.';

			if ( result.exitCode ) {
				return errorResult( output );
			}

			return textResult( output );
		} catch ( error ) {
			return errorResult(
				`Failed to import site: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);
