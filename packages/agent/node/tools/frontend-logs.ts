import { Type } from 'typebox';
import { resolveHeadlessSite } from '@studio/agent/node/headless';
import { defineTool, READ_ONLY } from './define-tool';
import { textResult } from './utils';

const DEFAULT_LINES = 100;
const MAX_LINES = 1000;

export const frontendLogsTool = defineTool(
	'frontend_logs',
	"Reads the latest output of a headless site's frontend dev server: build errors, failed data fetches, crashes. Use it when the frontend URL fails to load, shows an error, or renders stale or empty content. Fails for a site that is not headless.",
	{
		nameOrPath: Type.String( { description: 'The site name or file system path' } ),
		lines: Type.Optional(
			Type.Number( {
				minimum: 1,
				maximum: MAX_LINES,
				description: `How many of the latest lines to read. Defaults to ${ DEFAULT_LINES }.`,
			} )
		),
	},
	async ( args, context ) => {
		try {
			const site = await resolveHeadlessSite( context.host, args.nameOrPath );
			const lines = Math.min( Math.max( Math.floor( args.lines ?? DEFAULT_LINES ), 1 ), MAX_LINES );
			const output = ( await context.host.sites.frontendLogs( site, lines ) ).trim();
			return textResult(
				output || `The frontend of "${ site.name }" has not written any output yet.`
			);
		} catch ( error ) {
			throw new Error(
				`Failed to read the frontend logs: ${
					error instanceof Error ? error.message : String( error )
				}`
			);
		}
	},
	{
		promptSnippet: "Read the latest output of a headless site's frontend dev server, to debug it",
		annotations: READ_ONLY,
	}
);
