import { cp } from 'fs/promises';
import path from 'path';
import { z } from 'zod/v4';
import { tool } from './define-tool';
import { errorResult, resolveSite, textResult } from './utils';

const TAXONOMIST_SCRIPTS_DIR = 'tmp/taxonomist';

export const installTaxonomyScriptsTool = tool(
	'install_taxonomy_scripts',
	'Copies the Taxonomist PHP scripts into a site so they can be run via wp_cli eval-file. ' +
		'Call this once before running any Taxonomist eval-file commands.',
	{
		nameOrPath: z.string().describe( 'The site name or file system path to the site' ),
	},
	async ( args ) => {
		try {
			const site = await resolveSite( args.nameOrPath );
			const srcDir = path.join(
				import.meta.dirname,
				'..',
				'plugin',
				'skills',
				'taxonomist',
				'scripts'
			);
			const destDir = path.join( site.path, TAXONOMIST_SCRIPTS_DIR );

			await cp( srcDir, destDir, { recursive: true } );

			return textResult(
				`Taxonomist scripts installed to ${ TAXONOMIST_SCRIPTS_DIR }/ in the site directory.`
			);
		} catch ( error ) {
			return errorResult(
				`Failed to install taxonomy scripts: ${
					error instanceof Error ? error.message : String( error )
				}`
			);
		}
	}
);
