import { getFrontendUrl } from '@studio/common/lib/site-frontend';
import { Type } from 'typebox';
import { resolveHeadlessSite } from '@studio/agent/node/headless';
import { defineTool, LOCAL_CHANGE } from './define-tool';
import { textResult } from './utils';

export const frontendRestartTool = defineTool(
	'frontend_restart',
	"Restarts a headless site's frontend dev server, which Studio runs and supervises. Use it after changing the frontend's dependencies, config, or environment, or when frontend_logs shows it stopped. Never run the dev server (`npm run dev`, `astro dev`, `next dev`) through Bash. The WordPress site must be running. Fails for a site that is not headless.",
	{
		nameOrPath: Type.String( { description: 'The site name or file system path' } ),
	},
	async ( args, context ) => {
		try {
			const site = await resolveHeadlessSite( context.host, args.nameOrPath );
			if ( ! ( await context.host.sites.isRunning( site ) ) ) {
				throw new Error( `"${ site.name }" is stopped. Start it with site_start first.` );
			}
			context.onProgress( `Restarting the frontend of ${ site.name }…` );
			await context.host.sites.frontendRestart( site, context.onProgress );
			return textResult(
				`Restarted the frontend of "${ site.name }" at ${ getFrontendUrl( site.frontend ) }.`
			);
		} catch ( error ) {
			throw new Error(
				`Failed to restart the frontend: ${
					error instanceof Error ? error.message : String( error )
				}`
			);
		}
	},
	{
		promptSnippet: "Restart a headless site's frontend dev server (never run it through Bash)",
		annotations: LOCAL_CHANGE,
	}
);
