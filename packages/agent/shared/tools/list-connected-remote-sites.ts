import { formatRemoteSite, getProviderDescriptor, getSitesDescriptor } from '@studio/providers';
import { Type } from 'typebox';
import { defineTool, REMOTE_READ } from './define-tool';
import { textResult } from './utils';

export const listConnectedRemoteSitesTool = defineTool(
	'site_connected_remote_sites',
	'Lists the durable remote sites a local Studio site is connected to for publishing: WordPress.com and Pressable sites (production or staging), which it can push to and pull from, and sites on other providers such as Spacefast, which receive a static copy of the site and can only be pushed to. ' +
		'These are NOT temporary preview sites. Preview sites are listed by preview_list and must never be described as connected remote sites. ' +
		'Use this before calling site_push to determine how to ask the user which remote site to push to. ' +
		'Each entry names its `provider`, and `remoteSite`, which site_push and site_pull take as is. When `canPush` or `canPull` is false, `issue` says why: explain it to the user and do not attempt that sync. ' +
		'Returns an empty array when the local site has no connections.',
	{
		nameOrPath: Type.String( { description: 'The local site name or file system path' } ),
	},
	async ( args, context ) => {
		try {
			const site = await context.host.sites.resolve( args.nameOrPath );
			const connected = await context.host.sync.connectedSites( site );
			const summary = connected.map( ( { provider, site: remote } ) => {
				const sites = getSitesDescriptor( provider );
				const pushIssue = sites.issue( remote, 'push' );
				const pullIssue = sites.pull ? sites.issue( remote, 'pull' ) : null;
				return {
					type: 'remote-site' as const,
					provider,
					providerName: getProviderDescriptor( provider ).label,
					remoteSite: formatRemoteSite( provider, remote.id ),
					name: remote.name,
					url: remote.url,
					...Object.fromEntries(
						sites.details( remote ).map( ( { title, value } ) => [ title, value ] )
					),
					canPush: ! pushIssue,
					canPull: sites.pull && ! pullIssue,
					...( pushIssue || pullIssue ? { issue: pushIssue ?? pullIssue } : {} ),
					lastPushTimestamp: remote.lastPushTimestamp ?? null,
					lastPullTimestamp: remote.lastPullTimestamp ?? null,
				};
			} );
			return textResult( JSON.stringify( summary, null, 2 ) );
		} catch ( error ) {
			throw new Error(
				`Failed to list connected remote sites: ${
					error instanceof Error ? error.message : String( error )
				}`
			);
		}
	},
	{
		annotations: REMOTE_READ,
		promptSnippet:
			'List the durable remote sites (WordPress.com, or another provider such as Spacefast) a local site is connected to for publishing. These are distinct from temporary preview sites (preview_list). Call this before site_push to decide how to ask the user which remote site to target.',
	}
);
