import { normalizeHostname } from '@studio/common/lib/normalize-hostname';
import { Type } from 'typebox';
import { defineTool, REMOTE_OVERWRITE } from './define-tool';
import { failsAs, textResult } from './utils';

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
		return failsAs( 'Failed to delete preview site', async () => {
			await context.host.previews.delete( normalizedHost, context.onProgress );
			return textResult( `Preview site "${ normalizedHost }" deleted.` );
		} );
	},
	{ annotations: REMOTE_OVERWRITE }
);
