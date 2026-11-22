import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Type } from 'typebox';
import { skillFiles } from '@studio/agent/node/skills';
import { defineTool, LOCAL_CHANGE } from './define-tool';
import { textResult } from './utils';

const TAXONOMIST_SCRIPTS_DIR = 'tmp/taxonomist';

export const installTaxonomyScriptsTool = defineTool(
	'install_taxonomy_scripts',
	'Copies the Taxonomist PHP scripts into a site so they can be run via wp_cli eval-file. ' +
		'Call this once before running any Taxonomist eval-file commands.',
	{
		nameOrPath: Type.String( { description: 'The site name or file system path to the site' } ),
	},
	async ( args, context ) => {
		try {
			const site = await context.host.sites.resolve( args.nameOrPath );
			const destDir = path.join( site.path, TAXONOMIST_SCRIPTS_DIR );
			await mkdir( destDir, { recursive: true } );
			for ( const [ name, contents ] of skillFiles( 'taxonomist', 'scripts' ) ) {
				await writeFile( path.join( destDir, name ), contents );
			}

			return textResult(
				`Taxonomist scripts installed to ${ TAXONOMIST_SCRIPTS_DIR }/ in the site directory.`
			);
		} catch ( error ) {
			throw new Error(
				`Failed to install taxonomy scripts: ${
					error instanceof Error ? error.message : String( error )
				}`
			);
		}
	},
	{ annotations: LOCAL_CHANGE }
);
