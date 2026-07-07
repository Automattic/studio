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
	async ( args ) => {
		const normalizedHost = normalizeHostname( args.host );
		return runPreviewCommand(
			() => runDeletePreviewCommand( PreviewDeleteMode.DELETE_SINGLE_SNAPSHOT, normalizedHost ),
			`Preview site "${ normalizedHost }" deleted.`,
			'Failed to delete preview site'
		);
	}
);
