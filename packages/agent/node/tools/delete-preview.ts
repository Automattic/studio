import { normalizeHostname } from '@studio/common/lib/normalize-hostname';
import { Type } from 'typebox';
import { defineTool, REMOTE_OVERWRITE } from './define-tool';
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
		return runPreviewCommand( async () => {
			await context.host.previews.delete( normalizedHost, context.onProgress );
			return `Preview site "${ normalizedHost }" deleted.`;
		}, 'Failed to delete preview site' );
	},
	{ annotations: REMOTE_OVERWRITE }
);
