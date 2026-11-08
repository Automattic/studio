import { cp } from 'fs/promises';
import path from 'path';
import { Type } from 'typebox';
import { getSkillPath } from '@studio/agent/node/skills';
import { defineTool, LOCAL_CHANGE } from './define-tool';
import { failsAs, textResult } from './utils';

const TAXONOMIST_SCRIPTS_DIR = 'tmp/taxonomist';

export const installTaxonomyScriptsTool = defineTool(
	'install_taxonomy_scripts',
	'Copies the Taxonomist PHP scripts into a site so they can be run with `wp eval-file`. ' +
		'Call this once before running any Taxonomist eval-file commands.',
	{
		nameOrPath: Type.String( { description: 'The site name or file system path to the site' } ),
	},
	( args, context ) =>
		failsAs( 'Failed to install taxonomy scripts', async () => {
			const site = await context.host.sites.resolve( args.nameOrPath );
			const srcDir = getSkillPath( 'taxonomist', 'scripts' );
			const destDir = path.join( site.path, TAXONOMIST_SCRIPTS_DIR );

			await cp( srcDir, destDir, { recursive: true } );

			return textResult(
				`Taxonomist scripts installed to ${ TAXONOMIST_SCRIPTS_DIR }/ in the site directory.`
			);
		} ),
	{ annotations: LOCAL_CHANGE }
);
