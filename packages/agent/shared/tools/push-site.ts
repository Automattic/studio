import { Type } from 'typebox';
import { defineTool, REMOTE_OVERWRITE } from './define-tool';
import { textResult } from './utils';

export const pushSiteTool = defineTool(
	'site_push',
	'Pushes a local WordPress site to one of its remote sites: a WordPress.com or Pressable site, which requires the user to be signed in to WordPress.com, or a site on another provider such as Spacefast, which receives a static copy of the whole site. ' +
		'Exports the local site, uploads it, and applies it on the remote site. ' +
		'This can take several minutes depending on site size. ' +
		'Never call it without explicit user confirmation of the target remote site, even when only one site is attached. Resolve the target first with site_connected_remote_sites: ' +
		'with exactly one attached site, confirm it with AskUserQuestion when available (options "Yes" and "No", the description naming the remote site, its provider and its URL); ' +
		"with several, ask which one (one option per site: label = site name, description = provider and URL) and pass the chosen site's `remoteSite`; " +
		'with none, ask in plain text for the URL or ID of the WordPress.com site to push to, without AskUserQuestion, and wait for the reply.',
	{
		nameOrPath: Type.String( { description: 'The local site name or file system path' } ),
		remoteSite: Type.String( {
			description:
				'The remote site to push to: the `remoteSite` of an entry from site_connected_remote_sites, or a WordPress.com site URL or numeric site ID',
		} ),
		options: Type.Optional(
			Type.String( {
				description:
					'Comma-separated sync options: all, sqls, uploads, plugins, themes, contents. Defaults to "all". A provider that receives a static copy always gets the whole site.',
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
			'Push a local site to one of its remote sites: WordPress.com (requires signing in), or another provider such as Spacefast. Specify the remote site and sync options (all, sqls, uploads, plugins, themes, contents).',
		annotations: REMOTE_OVERWRITE,
	}
);
