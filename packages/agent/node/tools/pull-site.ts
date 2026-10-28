import { Type } from 'typebox';
import { defineTool, REMOTE_OVERWRITE } from './define-tool';
import { textResult } from './utils';

export const pullSiteTool = defineTool(
	'site_pull',
	'Pulls a WordPress.com site to a local WordPress site. Requires WordPress.com authentication ' +
		'(studio auth login). Creates a remote backup, downloads it, and imports it locally. ' +
		'This can take several minutes depending on site size. ' +
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
			const result = await context.host.sync.pull(
				site,
				args.options ?? 'all',
				args.remoteSite,
				context.onProgress
			);
			const output = result.consoleOutput || result.progressOutput || 'Pull completed.';

			if ( result.exitCode ) {
				throw new Error( output );
			}

			return textResult( output );
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
