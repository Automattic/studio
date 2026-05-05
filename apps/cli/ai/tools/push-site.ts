import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod/v4';
import { runCommand as runPushCommand } from 'cli/commands/push';
import { parseSyncOptions } from 'cli/lib/sync-api';
import { captureCommandOutput, errorResult, resolveSite, textResult } from './utils';

export const pushSiteTool = tool(
	'site_push',
	'Pushes a local WordPress site to a WordPress.com site. Requires WordPress.com authentication ' +
		'(studio auth login). Exports the local site, uploads it, and imports it on the remote site. ' +
		'This can take several minutes depending on site size.',
	{
		nameOrPath: z.string().describe( 'The local site name or file system path' ),
		remoteSite: z
			.string()
			.describe( 'The remote WordPress.com site URL or numeric site ID to push to' ),
		options: z
			.string()
			.optional()
			.describe(
				'Comma-separated sync options: all, sqls, uploads, plugins, themes, contents. Defaults to "all".'
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
				return errorResult( output );
			}

			return textResult( output );
		} catch ( error ) {
			return errorResult(
				`Failed to push site: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);
