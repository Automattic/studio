import { Type } from 'typebox';
import { defineTool, REMOTE_CHANGE } from './define-tool';
import { runPreviewCommand } from './preview-helpers';

export const createPreviewTool = defineTool(
	'preview_create',
	'Creates a preview site from a local Studio site. A "temporary site", "temporal site", or "share link" all mean a preview site — use this tool for those requests. When a local site is already selected and the user asks to create a temporary/temporal/preview site, create a preview of the selected site rather than a new local site. Requires WordPress.com authentication. This can take a few minutes, so tell the user to wait after starting it.',
	{
		nameOrPath: Type.String( {
			description: 'The local site name or file system path to preview',
		} ),
	},
	async ( args, context ) => {
		return runPreviewCommand( async () => {
			const site = await context.host.sites.resolve( args.nameOrPath );
			const preview = await context.host.previews.create( site, context.onProgress );
			return `Preview site "${ preview.name }" created from "${ site.name }": https://${ preview.url }`;
		}, 'Failed to create preview site' );
	},
	{
		promptSnippet:
			'Create a preview site (a temporary, expiring hosted preview) for a local site; when a local site is selected, preview that site instead of creating a new local site; requires WordPress.com authentication and can take a few minutes, so tell the user to wait',
		annotations: REMOTE_CHANGE,
	}
);
