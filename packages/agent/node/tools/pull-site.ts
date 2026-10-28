import { Type } from 'typebox';
import { defineTool, REMOTE_OVERWRITE } from './define-tool';
import { textResult } from './utils';
import type { StudioToolDefinition } from './define-tool';

// The tool, with the hosts it can pull from: those that serve WordPress.
function createPullSiteTool( hostIds: string[] ) {
	return defineTool(
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
					hostIds.map( ( id ) => Type.Literal( id ) ),
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
				const site = await context.host.sites.resolve( args.nameOrPath );
				const remoteHost = context.host.remoteHosts[ args.host ?? 'wpcom' ];
				if ( ! remoteHost.pull ) {
					throw new Error( `${ remoteHost.name } serves static copies, which cannot be pulled.` );
				}
				return textResult(
					await remoteHost.pull( site, args.remoteSite, args.options ?? 'all', context.onProgress )
				);
			} catch ( error ) {
				throw new Error(
					`Failed to pull site: ${ error instanceof Error ? error.message : String( error ) }`
				);
			}
		},
		{
			annotations: REMOTE_OVERWRITE,
			forHost: ( _options, host ): StudioToolDefinition | undefined =>
				createPullSiteTool(
					Object.entries( host.remoteHosts )
						.filter( ( [ , remoteHost ] ) => remoteHost.pull )
						.map( ( [ id ] ) => id )
				),
		}
	);
}

export const pullSiteTool = createPullSiteTool( [ 'wpcom' ] );
