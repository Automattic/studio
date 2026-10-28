import { Type } from 'typebox';
import { defineTool, REMOTE_READ } from './define-tool';
import { textResult } from './utils';

export const publishTargetsTool = defineTool(
	'site_publish_targets',
	'Lists where a local site can be published: each host built into Studio, what it publishes to, ' +
		'whether the user is signed in to it, and the sites on it already connected to the local site. ' +
		'A connected site is a target for site_push and site_pull, and so is a site the user names on one of these hosts. ' +
		"A WordPress.com target's `syncSupport` says whether it can be pushed or pulled now: `syncable` and `already-connected` can; for the others, site_push and site_pull say what each needs (an upgrade, a transfer, or admin access). " +
		'Preview sites are temporary copies, listed by preview_list.',
	{
		nameOrPath: Type.String( { description: 'The local site name or file system path' } ),
	},
	async ( args, context ) => {
		try {
			const site = await context.host.sites.resolve( args.nameOrPath );
			const hosts = await Promise.all(
				Object.entries( context.host.remoteHosts ).map( async ( [ id, host ] ) => {
					const { signedIn, targets, error } = await host.targets( site );
					return {
						host: id,
						name: host.name,
						publishes: host.publishes,
						signedIn,
						...( signedIn ? {} : { signIn: host.signIn } ),
						...( error ? { error } : {} ),
						targets,
					};
				} )
			);
			return textResult( JSON.stringify( hosts, null, 2 ) );
		} catch ( error ) {
			throw new Error(
				`Failed to list publish targets: ${
					error instanceof Error ? error.message : String( error )
				}`
			);
		}
	},
	{
		annotations: REMOTE_READ,
	}
);
