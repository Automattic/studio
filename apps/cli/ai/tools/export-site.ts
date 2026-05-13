import path from 'path';
import { Type } from 'typebox';
import { runCommand as runExportCommand } from 'cli/commands/export';
import { defineTool } from './define-tool';
import { captureCommandOutput, resolveSite, textResult } from './utils';

export const exportSiteTool = defineTool(
	'site_export',
	'Exports a local WordPress site to a backup file. Supports full-site export (.zip or .tar.gz) ' +
		'or database-only export (.sql). If no export file path is provided, creates a timestamped file in the current directory.',
	{
		nameOrPath: Type.String( { description: 'The local site name or file system path' } ),
		exportFile: Type.Optional(
			Type.String( {
				description:
					'Path for the export file. Use .zip or .tar.gz for full export, .sql for database only. ' +
					'If omitted, a timestamped file is created in the current directory.',
			} )
		),
		mode: Type.Optional(
			Type.Enum( [ 'full', 'db' ], {
				description:
					'Export mode: "full" for entire site, "db" for database only. Defaults to "full".',
			} )
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
				throw new Error( output );
			}

			return textResult( output );
		} catch ( error ) {
			throw new Error(
				`Failed to export site: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);
