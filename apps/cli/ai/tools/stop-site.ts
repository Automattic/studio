import { Type } from 'typebox';
import { runCommand as runStopSiteCommand, Mode as StopMode } from 'cli/commands/site/stop';
import { defineTool } from './define-tool';
import { resolveSite, textResult } from './utils';

export const stopSiteTool = defineTool(
	'site_stop',
	'Stops a running WordPress site by name or path.',
	{
		nameOrPath: Type.String( { description: 'The site name or file system path to the site' } ),
	},
	async ( args ) => {
		try {
			const site = await resolveSite( args.nameOrPath );
			await runStopSiteCommand( StopMode.STOP_SINGLE_SITE, site.path );
			return textResult( `Site "${ site.name }" stopped.` );
		} catch ( error ) {
			throw new Error(
				`Failed to stop site: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);
