import path from 'path';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod/v4';
import { runCommand as runExportCommand } from 'cli/commands/export';
import { captureCommandOutput, errorResult, resolveSite, textResult } from './utils';

export const exportSiteTool = tool(
	'site_export',
	'Exports a local WordPress site to a backup file. Supports full-site export (.zip or .tar.gz) ' +
		'or database-only export (.sql). If no export file path is provided, creates a timestamped file in the current directory.',
	{
		nameOrPath: z.string().describe( 'The local site name or file system path' ),
		exportFile: z
			.string()
			.optional()
			.describe(
				'Path for the export file. Use .zip or .tar.gz for full export, .sql for database only. ' +
					'If omitted, a timestamped file is created in the current directory.'
			),
		mode: z
			.enum( [ 'full', 'db' ] )
			.optional()
			.describe(
				'Export mode: "full" for entire site, "db" for database only. Defaults to "full".'
			),
	},
	async ( args ) => {
		try {
			const site = await resolveSite( args.nameOrPath );
			const mode = args.mode ?? 'full';

			let exportFile = args.exportFile;
			if ( ! exportFile ) {
				const timestamp = new Date().toISOString().replace( /[:.]/g, '-' ).slice( 0, 19 );
				const ext = mode === 'db' ? '.sql' : '.zip';
				exportFile = path.join( process.cwd(), `studio-backup-${ timestamp }${ ext }` );
			}

			const result = await captureCommandOutput( () =>
				runExportCommand( site.path, exportFile, mode )
			);
			const output = result.consoleOutput || result.progressOutput || `Exported to ${ exportFile }`;

			if ( result.exitCode ) {
				return errorResult( output );
			}

			return textResult( output );
		} catch ( error ) {
			return errorResult(
				`Failed to export site: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);
