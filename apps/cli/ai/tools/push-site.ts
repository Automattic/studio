import { Type } from 'typebox';
import { runCommand as runPushCommand } from 'cli/commands/push';
import { parseSyncOptions } from 'cli/lib/sync-api';
import { defineTool } from './define-tool';
import { captureCommandOutput, resolveSite, textResult } from './utils';

export const pushSiteTool = defineTool(
	'site_push',
	'Pushes a local WordPress site to a WordPress.com site. Requires WordPress.com authentication ' +
		'(studio auth login). Exports the local site, uploads it, and imports it on the remote site. ' +
		'This can take several minutes depending on site size.',
	{
		nameOrPath: Type.String( { description: 'The local site name or file system path' } ),
		remoteSite: Type.String( {
			description: 'The remote WordPress.com site URL or numeric site ID to push to',
		} ),
		options: Type.Optional(
			Type.String( {
				description:
					'Comma-separated sync options: all, sqls, uploads, plugins, themes, contents. Defaults to "all".',
			} )
		),
	},
	async ( args ) => {
		try {
			const site = await resolveSite( args.nameOrPath );
			const syncOptions = parseSyncOptions( args.options ?? 'all' );

			const result = await captureCommandOutput( () =>
				runPushCommand( site.path, syncOptions, args.remoteSite )
			);
			const output = result.consoleOutput || result.progressOutput || 'Push completed.';

			if ( result.exitCode ) {
				throw new Error( output );
			}

			return textResult( output );
		} catch ( error ) {
			throw new Error(
				`Failed to push site: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);
