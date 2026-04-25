import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod/v4';
import { runCommand as runPullCommand } from 'cli/commands/pull';
import { parseSyncOptions } from 'cli/lib/sync-api';
import { captureCommandOutput, errorResult, resolveSite, textResult } from './utils';

export const pullSiteTool = tool(
	'site_pull',
	'Pulls a WordPress.com site to a local WordPress site. Requires WordPress.com authentication ' +
		'(studio auth login). Creates a remote backup, downloads it, and imports it locally. ' +
		'This can take several minutes depending on site size.',
	{
		nameOrPath: z.string().describe( 'The local site name or file system path' ),
		remoteSite: z
			.string()
			.describe( 'The remote WordPress.com site URL or numeric site ID to pull from' ),
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
				runPullCommand( site.path, syncOptions, args.remoteSite )
			);
			const output = result.consoleOutput || result.progressOutput || 'Pull completed.';

			if ( result.exitCode ) {
				return errorResult( output );
			}

			return textResult( output );
		} catch ( error ) {
			return errorResult(
				`Failed to pull site: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	}
);
