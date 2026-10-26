import { Type } from 'typebox';
import { HOST_IDS, HOSTS } from 'cli/ai/hosts';
import { parseSyncOptions } from 'cli/lib/sync-api';
import { defineTool, REMOTE_OVERWRITE } from './define-tool';
import { captureCommandOutput, resolveSite, textResult } from './utils';

export const pushSiteTool = defineTool(
	'site_push',
	'Pushes a local WordPress site to a remote site on one of the hosts in site_publish_targets: ' +
		'exports the local site, uploads it, and imports it on the remote site. ' +
		'This can take several minutes depending on site size. ' +
		'remoteSite is one of the targets site_publish_targets lists, or a site the user names. ' +
		'Studio asks the user to confirm the target before the push starts.',
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
			description: "The remote site URL or the host's id for it, to push to",
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
					HOSTS[ args.host ?? 'wpcom' ].push( site.path, args.remoteSite, syncOptions, logger ),
				context.onProgress
			);
			const output = result.consoleOutput || result.progressOutput || 'Push completed.';

			if ( result.exitCode ) {
				throw new Error( output );
			}

			return textResult( output );
		} catch ( error ) {
			throw new Error(
				`Failed to push site: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	},
	{
		annotations: REMOTE_OVERWRITE,
	}
);
