import { Type } from 'typebox';
import { studioHost } from '@studio/agent/node/host';
import { defineTool, LOCAL_OVERWRITE } from './define-tool';
import { resolveSite, textResult } from './utils';

export const importSiteTool = defineTool(
	'site_import',
	'Imports a backup file into a local WordPress site. Supports .zip, .tar.gz, .sql, .wpress, and WordPress export (WXR) .xml formats. ' +
		'The site server will be stopped during import and restarted afterward if it was running.',
	{
		nameOrPath: Type.String( { description: 'The local site name or file system path' } ),
		importFile: Type.String( { description: 'Absolute path to the backup file to import' } ),
	},
	async ( args, context ) => {
		try {
			const site = await resolveSite( args.nameOrPath );

			const result = await studioHost().sites.import( site, args.importFile, context.onProgress );
			const output = result.consoleOutput || result.progressOutput || 'Import completed.';

			if ( result.exitCode ) {
				throw new Error( output );
			}

			return textResult( output );
		} catch ( error ) {
			throw new Error(
				`Failed to import site: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	},
	{
		promptSnippet:
			'Import a backup file (.zip, .tar.gz, .sql, .wpress, .xml WordPress export) into a local site.',
		annotations: LOCAL_OVERWRITE,
	}
);
