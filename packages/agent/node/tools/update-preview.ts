import { normalizeHostname } from '@studio/common/lib/normalize-hostname';
import { Type } from 'typebox';
import { defineTool, REMOTE_OVERWRITE } from './define-tool';
import { runPreviewCommand } from './preview-helpers';

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
	async ( args, context ) => {
		const normalizedHost = normalizeHostname( args.host );
		return runPreviewCommand(
			async () => {
				const site = await context.host.sites.resolve( args.nameOrPath );
				return context.host.previews.update(
					site,
					normalizedHost,
					args.overwrite ?? false,
					context.onProgress
				);
			},
			`Preview site "${ normalizedHost }" updated from "${ args.nameOrPath }".`,
			'Failed to update preview site'
		);
	},
	{
		promptSnippet:
			'Update an existing preview site from a local site; this can take a few minutes, so tell the user to wait',
		annotations: REMOTE_OVERWRITE,
	}
);
