import { normalizeHostname } from '@studio/common/lib/normalize-hostname';
import { getSnapshotLink } from '@studio/common/lib/snapshots';
import { Type } from 'typebox';
import { defineTool, REMOTE_OVERWRITE } from './define-tool';
import { failsAs, textResult } from './utils';

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
		return failsAs( 'Failed to update preview site', async () => {
			const site = await context.host.sites.resolve( args.nameOrPath );
			const preview = await context.host.previews.update(
				site,
				normalizedHost,
				args.overwrite ?? false,
				context.onProgress
			);
			const link = getSnapshotLink( preview );
			const moved =
				preview.url !== normalizedHost
					? ' The preview moved to WordPress.com, so its link changed; use the new link from now on.'
					: '';
			return textResult(
				`Preview site "${ preview.name }" updated from "${ site.name }": ${ link }${ moved }`
			);
		} );
	},
	{
		annotations: REMOTE_OVERWRITE,
	}
);
