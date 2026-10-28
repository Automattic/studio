import { Type } from 'typebox';
import { defineTool, REMOTE_OVERWRITE } from './define-tool';
import { textResult } from './utils';
import type { StudioToolDefinition } from './define-tool';

// The tool, with the hosts it can push to.
function createPushSiteTool( hostIds: string[] ) {
	return defineTool(
		'site_push',
		"Replaces a remote site's content on one of the hosts in site_publish_targets with the local site's; " +
			"the host's `publishes` says what that makes there. " +
			'This can take several minutes depending on site size. ' +
			'remoteSite is one of the targets site_publish_targets lists, or a site the user names. ' +
			'Studio asks the user to confirm the target before the push starts.',
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
				description: "The remote site URL or the host's id for it, to push to",
			} ),
			options: Type.Optional(
				Type.String( {
					description:
						'For WordPress.com, comma-separated sync options: all, sqls, uploads, plugins, themes, contents. Defaults to "all".',
				} )
			),
		},
		async ( args, context ) => {
			try {
				const site = await context.host.sites.resolve( args.nameOrPath );
				const remoteHost = context.host.remoteHosts[ args.host ?? 'wpcom' ];
				return textResult(
					await remoteHost.push( site, args.remoteSite, args.options ?? 'all', context.onProgress )
				);
			} catch ( error ) {
				throw new Error(
					`Failed to push site: ${ error instanceof Error ? error.message : String( error ) }`
				);
			}
		},
		{
			annotations: REMOTE_OVERWRITE,
			forHost: ( _options, host ): StudioToolDefinition | undefined =>
				createPushSiteTool( Object.keys( host.remoteHosts ) ),
		}
	);
}

export const pushSiteTool = createPushSiteTool( [ 'wpcom' ] );
