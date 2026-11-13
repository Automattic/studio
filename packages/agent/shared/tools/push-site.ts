import { Type } from 'typebox';
import { defineTool, REMOTE_OVERWRITE } from './define-tool';
import { failsAs, textResult } from './utils';

export const pushSiteTool = defineTool(
	'site_push',
	'Pushes a local WordPress site to one of its remote sites: a WordPress.com or Pressable site, which requires the user to be signed in to WordPress.com, or a site on another provider such as Spacefast, which receives a static copy of the whole site. ' +
		'Exports the local site, uploads it, and applies it on the remote site. ' +
		'This can take several minutes depending on site size. ' +
		'remoteSite is one of the sites site_connected_remote_sites lists, or a WordPress.com site the user names. ' +
		'Studio asks the user to confirm the target before the push starts.',
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
	( args, context ) =>
		failsAs( 'Failed to push site', async () => {
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
		} ),
	{ annotations: REMOTE_OVERWRITE }
);
