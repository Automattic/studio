import { getProvider, getProviderSites, parseRemoteSite } from '@studio/providers';
import { Type } from 'typebox';
import { defineTool, REMOTE_OVERWRITE } from './define-tool';
import { textResult } from './utils';

export const pullSiteTool = defineTool(
	'site_pull',
	'Pulls a WordPress.com site to a local WordPress site. Requires the user to be signed in to WordPress.com. ' +
		'Copies the remote site into the local one, which can take several minutes ' +
		'depending on site size. ' +
		'Make sure a local site exists first (create one with site_create if needed); a running local site is stopped during the pull and restarted afterward. ' +
		'Never call it without explicit user confirmation: it overwrites the local site.',
	{
		nameOrPath: Type.String( { description: 'The local site name or file system path' } ),
		remoteSite: Type.String( {
			description:
				'The remote site to pull from: the `remoteSite` of an entry from site_connected_remote_sites, or a WordPress.com site URL or numeric site ID',
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
			const { provider, identifier } = parseRemoteSite( args.remoteSite );
			if ( ! getProviderSites( provider ).pull ) {
				throw new Error(
					`${ getProvider( provider ).label } sites can only be published to, not pulled.`
				);
			}
			const site = await context.host.sites.resolve( args.nameOrPath );
			const remoteSite = await context.host.sync.pull(
				site,
				args.options ?? 'all',
				identifier,
				context.onProgress
			);
			return textResult(
				remoteSite
					? `Pulled ${ remoteSite.name } (${ remoteSite.url }) into "${ site.name }".`
					: 'Pull cancelled.'
			);
		} catch ( error ) {
			throw new Error(
				`Failed to pull site: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	},
	{
		promptSnippet:
			'Pull a WordPress.com site to a local site. Requires authentication. Specify the remote site URL or ID and sync options.',
		annotations: REMOTE_OVERWRITE,
	}
);
