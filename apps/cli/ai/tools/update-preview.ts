import { z } from 'zod/v4';
import { runCommand as runUpdatePreviewCommand } from 'cli/commands/preview/update';
import { normalizeHostname } from 'cli/lib/utils';
import { tool } from './define-tool';
import { runPreviewCommand } from './preview-helpers';
import { resolveSite } from './utils';

export const updatePreviewTool = tool(
	'preview_update',
	'Updates an existing WordPress.com preview site from a local Studio site. Requires WordPress.com authentication. This can take a few minutes, so tell the user to wait after starting it.',
	{
		nameOrPath: z.string().describe( 'The local site name or file system path' ),
		host: z
			.string()
			.describe( 'The preview hostname or URL to update, for example "site.wordpress.com"' ),
		overwrite: z
			.boolean()
			.optional()
			.describe(
				'Allow updating the preview from a different local directory. Defaults to false.'
			),
	},
	async ( args ) => {
		const normalizedHost = normalizeHostname( args.host );
		return runPreviewCommand(
			async () => {
				const site = await resolveSite( args.nameOrPath );
				await runUpdatePreviewCommand( site.path, normalizedHost, args.overwrite ?? false );
			},
			`Preview site "${ normalizedHost }" updated from "${ args.nameOrPath }".`,
			'Failed to update preview site'
		);
	}
);
