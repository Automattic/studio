import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod/v4';
import {
	Mode as PreviewDeleteMode,
	runCommand as runDeletePreviewCommand,
} from 'cli/commands/preview/delete';
import { normalizeHostname } from 'cli/lib/utils';
import { runPreviewCommand } from './utils';

export const deletePreviewTool = tool(
	'preview_delete',
	'Deletes a WordPress.com preview site by hostname or URL. Requires WordPress.com authentication.',
	{
		host: z
			.string()
			.describe( 'The preview hostname or URL to delete, for example "site.wordpress.com"' ),
	},
	async ( args ) => {
		const normalizedHost = normalizeHostname( args.host );
		return runPreviewCommand(
			() => runDeletePreviewCommand( PreviewDeleteMode.DELETE_SINGLE_SNAPSHOT, normalizedHost ),
			`Preview site "${ normalizedHost }" deleted.`,
			'Failed to delete preview site'
		);
	}
);
