import { Type } from 'typebox';
import { runCommand as runUpdatePreviewCommand } from 'cli/commands/preview/update';
import { normalizeHostname } from 'cli/lib/utils';
import { defineTool } from './define-tool';
import { runPreviewCommand } from './preview-helpers';
import { resolveSite } from './utils';

export const updatePreviewTool = defineTool(
	'preview_update',
	'Updates an existing WordPress.com preview site from a local Studio site. Requires WordPress.com authentication. This can take a few minutes, so tell the user to wait after starting it.',
	{
		nameOrPath: Type.String( { description: 'The local site name or file system path' } ),
		host: Type.String( {
			description: 'The preview hostname or URL to update, for example "site.wordpress.com"',
		} ),
		overwrite: Type.Optional(
			Type.Boolean( {
				description:
					'Allow updating the preview from a different local directory. Defaults to false.',
			} )
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
