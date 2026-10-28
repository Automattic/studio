import { Type } from 'typebox';
import { defineTool, REMOTE_OVERWRITE } from './define-tool';
import { textResult } from './utils';

export const pushSiteTool = defineTool(
	'site_push',
	'Pushes a local WordPress site to a WordPress.com site. Requires WordPress.com authentication ' +
		'(studio auth login). Exports the local site, uploads it, and imports it on the remote site. ' +
		'This can take several minutes depending on site size. ' +
		'Never call it without explicit user confirmation of the target remote site, even when only one site is attached. Resolve the target first with site_connected_remote_sites: ' +
		'with exactly one attached site, confirm it with AskUserQuestion when available (options "Yes" and "No", the description naming the remote site and its URL); ' +
		"with several, ask which one (one option per site: label = site name, description = URL) and pass the chosen site's ID or URL as remoteSite; " +
		'with none, ask in plain text for the URL or ID of the WordPress.com site to push to, without AskUserQuestion, and wait for the reply.',
	{
		nameOrPath: Type.String( { description: 'The local site name or file system path' } ),
		remoteSite: Type.String( {
			description: 'The remote WordPress.com site URL or numeric site ID to push to',
		} ),
		options: Type.Optional(
			Type.String( {
				description:
					'Comma-separated sync options: all, sqls, uploads, plugins, themes, contents. Defaults to "all".',
			} )
		),
	},
	async ( args, context ) => {
		try {
			const site = await context.host.sites.resolve( args.nameOrPath );
			const remoteSite = await context.host.sync.push(
				site,
				args.options ?? 'all',
				args.remoteSite,
				context.onProgress
			);
			return textResult(
				remoteSite
					? `Pushed "${ site.name }" to ${ remoteSite.name } (${ remoteSite.url }).`
					: 'Push cancelled.'
			);
		} catch ( error ) {
			throw new Error(
				`Failed to push site: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	},
	{
		promptSnippet:
			'Push a local site to a WordPress.com site. Requires authentication (studio auth login). Specify the remote site URL or ID and sync options (all, sqls, uploads, plugins, themes, contents).',
		annotations: REMOTE_OVERWRITE,
	}
);
