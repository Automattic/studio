import { Type } from 'typebox';
import { runCommand as runStartSiteCommand } from 'cli/commands/site/start';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import { Logger } from 'cli/logger';
import { defineTool } from './define-tool';
import { resolveSite, textResult } from './utils';

export const startSiteTool = defineTool(
	'site_start',
	'Starts a WordPress site by name or path. The site must already exist in Studio.',
	{
		nameOrPath: Type.String( { description: 'The site name or file system path to the site' } ),
	},
	async ( args, context ) => {
		try {
			const site = await resolveSite( args.nameOrPath );
			await runStartSiteCommand(
				site.path,
				true,
				true,
				new Logger( { onProgress: context.onProgress } )
			);
			return textResult( `Site "${ site.name }" started at ${ getSiteUrl( site ) }` );
		} catch ( error ) {
			throw new Error(
				`Failed to start site: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);
