import { getConnectedWpcomSitesForLocalSite } from '@studio/common/lib/connected-sites';
import { Type } from 'typebox';
import { defineTool } from './define-tool';
import { resolveSite, textResult } from './utils';

export const listConnectedRemoteSitesTool = defineTool(
	'site_connected_remote_sites',
	'Lists the durable WordPress.com remote sites that are already connected/attached to a local Studio site for push/pull syncing. ' +
		'These are real WordPress.com sites (production or staging) — NOT temporary preview sites. Preview sites are listed by preview_list and must never be described as connected WordPress.com remote sites. ' +
		'Use this before calling site_push to determine how to ask the user which remote site to push to. ' +
		'Returns an empty array when the user has no connections for that local site. ' +
		'Each entry is tagged with "type": "wpcom-remote".',
	{
		nameOrPath: Type.String( { description: 'The local site name or file system path' } ),
	},
	async ( args ) => {
		try {
			const site = await resolveSite( args.nameOrPath );
			const connected = await getConnectedWpcomSitesForLocalSite( site.id );
			const summary = connected.map( ( s ) => ( {
				type: 'wpcom-remote' as const,
				id: s.id,
				name: s.name,
				url: s.url,
				isStaging: s.isStaging,
				isPressable: s.isPressable,
				environmentType: s.environmentType ?? null,
				syncSupport: s.syncSupport,
				lastPushTimestamp: s.lastPushTimestamp,
				lastPullTimestamp: s.lastPullTimestamp,
			} ) );
			return textResult( JSON.stringify( summary, null, 2 ) );
		} catch ( error ) {
			throw new Error(
				`Failed to list connected remote sites: ${
					error instanceof Error ? error.message : String( error )
				}`
			);
		}
	}
);
