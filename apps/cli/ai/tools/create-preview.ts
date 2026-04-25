import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod/v4';
import { runCommand as runCreatePreviewCommand } from 'cli/commands/preview/create';
import { runPreviewCommand } from './preview-helpers';
import { resolveSite } from './utils';

export const createPreviewTool = tool(
	'preview_create',
	'Creates a WordPress.com preview site from a local Studio site. Requires WordPress.com authentication. This can take a few minutes, so tell the user to wait after starting it.',
	{
		nameOrPath: z.string().describe( 'The local site name or file system path to preview' ),
	},
	async ( args ) => {
		return runPreviewCommand(
			async () => {
				const site = await resolveSite( args.nameOrPath );
				await runCreatePreviewCommand( site.path );
			},
			`Preview site created for "${ args.nameOrPath }".`,
			'Failed to create preview site'
		);
	}
);
