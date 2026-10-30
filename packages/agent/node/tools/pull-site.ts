import { Type } from 'typebox';
import { defineTool, REMOTE_OVERWRITE } from './define-tool';
import { textResult } from './utils';

export const pullSiteTool = defineTool(
	'site_pull',
	'Pulls a WordPress.com site to a local WordPress site. Requires WordPress.com authentication ' +
		'(studio auth login). The first pull copies the whole site and can take several minutes; ' +
		'later pulls only fetch what changed. ' +
		'Make sure a local site exists first (create one with site_create if needed); a running local site is stopped during the pull and restarted afterward. ' +
		'Never call it without explicit user confirmation: it overwrites the local site.',
	{
		nameOrPath: Type.String( { description: 'The local site name or file system path' } ),
		remoteSite: Type.String( {
			description: 'The remote WordPress.com site URL or numeric site ID to pull from',
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
			const remoteSite = await context.host.sync.pull(
				site,
				args.options ?? 'all',
				args.remoteSite,
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
