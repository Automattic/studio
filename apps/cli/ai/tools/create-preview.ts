import { Type } from 'typebox';
import { runCommand as runCreatePreviewCommand } from 'cli/commands/preview/create';
import { defineTool } from './define-tool';
import { runPreviewCommand } from './preview-helpers';
import { resolveSite } from './utils';

export const createPreviewTool = defineTool(
	'preview_create',
	'Creates a WordPress.com preview site from a local Studio site. Requires WordPress.com authentication. This can take a few minutes, so tell the user to wait after starting it.',
	{
		nameOrPath: Type.String( {
			description: 'The local site name or file system path to preview',
		} ),
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
