import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod/v4';
import { runCommand as runListPreviewCommand } from 'cli/commands/preview/list';
import { resolveSite, runPreviewCommand } from './utils';

export const listPreviewsTool = tool(
	'preview_list',
	'Lists WordPress.com preview sites associated with a local Studio site. Requires WordPress.com authentication.',
	{
		nameOrPath: z.string().describe( 'The local site name or file system path' ),
	},
	async ( args ) => {
		return runPreviewCommand(
			async () => {
				const site = await resolveSite( args.nameOrPath );
				await runListPreviewCommand( site.path, 'json' );
			},
			`No preview sites found for "${ args.nameOrPath }".`,
			'Failed to list preview sites'
		);
	}
);
