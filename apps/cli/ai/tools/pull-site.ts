import { Type } from 'typebox';
import { runCommand as runPullCommand } from 'cli/commands/pull';
import { parseSyncOptions } from 'cli/lib/sync-api';
import { defineTool } from './define-tool';
import { captureCommandOutput, resolveSite, textResult } from './utils';

export const pullSiteTool = defineTool(
	'site_pull',
	'Pulls a WordPress.com site to a local WordPress site. Requires WordPress.com authentication ' +
		'(studio auth login). Creates a remote backup, downloads it, and imports it locally. ' +
		'This can take several minutes depending on site size.',
	{
		nameOrPath: Type.String( { description: 'The local site name or file system path' } ),
		remoteSite: Type.String( {
			description: 'The remote WordPress.com site URL or numeric site ID to pull from',
		} ),
		options: Type.Optional(
			Type.String( {
				description:
					'Comma-separated sync options: all, sqls, uploads, plugins, themes, contents. Defaults to "all".',
			} )
		),
	},
	async ( args, context ) => {
		try {
			const site = await resolveSite( args.nameOrPath );
			const syncOptions = parseSyncOptions( args.options ?? 'all' );

			const result = await captureCommandOutput(
				( logger ) => runPullCommand( site.path, syncOptions, args.remoteSite, undefined, logger ),
				context.onProgress
			);
			const output = result.consoleOutput || result.progressOutput || 'Pull completed.';

			if ( result.exitCode ) {
				throw new Error( output );
			}

			return textResult( output );
		} catch ( error ) {
			throw new Error(
				`Failed to pull site: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);
