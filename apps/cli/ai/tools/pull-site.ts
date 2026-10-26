import { Type } from 'typebox';
import { HOST_IDS, HOSTS } from 'cli/ai/hosts';
import { parseSyncOptions } from 'cli/lib/sync-api';
import { defineTool, REMOTE_OVERWRITE } from './define-tool';
import { captureCommandOutput, resolveSite, textResult } from './utils';

export const pullSiteTool = defineTool(
	'site_pull',
	'Pulls a remote site on one of the hosts in site_publish_targets to a local WordPress site: ' +
		'creates a remote backup, downloads it, and imports it locally. ' +
		'This can take several minutes depending on site size. ' +
		'Make sure a local site exists first (create one with site_create if needed); a running local site is stopped during the pull and restarted afterward. ' +
		'Studio asks the user to confirm before the pull overwrites the local site.',
	{
		nameOrPath: Type.String( { description: 'The local site name or file system path' } ),
		host: Type.Optional(
			Type.Union(
				HOST_IDS.map( ( id ) => Type.Literal( id ) ),
				{
					description:
						'The host the remote site is on, from site_publish_targets. Defaults to "wpcom".',
				}
			)
		),
		remoteSite: Type.String( {
			description: "The remote site URL or the host's id for it, to pull from",
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
			const site = await resolveSite( args.nameOrPath );
			const syncOptions = parseSyncOptions( args.options ?? 'all' );

			const result = await captureCommandOutput(
				( logger ) =>
					HOSTS[ args.host ?? 'wpcom' ].pull( site.path, args.remoteSite, syncOptions, logger ),
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
		annotations: REMOTE_OVERWRITE,
	}
);
