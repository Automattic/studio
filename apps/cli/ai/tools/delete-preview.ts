import { Type } from 'typebox';
import {
	Mode as PreviewDeleteMode,
	runCommand as runDeletePreviewCommand,
} from 'cli/commands/preview/delete';
import { normalizeHostname } from 'cli/lib/utils';
import { defineTool } from './define-tool';
import { runPreviewCommand } from './preview-helpers';

export const deletePreviewTool = defineTool(
	'preview_delete',
	'Deletes a WordPress.com preview site by hostname or URL. Requires WordPress.com authentication.',
	{
		host: Type.String( {
			description: 'The preview hostname or URL to delete, for example "site.wordpress.com"',
		} ),
	},
	async ( args, context ) => {
		const normalizedHost = normalizeHostname( args.host );
		return runPreviewCommand(
			( logger ) =>
				runDeletePreviewCommand( PreviewDeleteMode.DELETE_SINGLE_SNAPSHOT, normalizedHost, logger ),
			`Preview site "${ normalizedHost }" deleted.`,
			'Failed to delete preview site',
			context.onProgress
		);
	}
);
