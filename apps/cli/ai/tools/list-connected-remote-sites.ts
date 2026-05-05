import { tool } from '@anthropic-ai/claude-agent-sdk';
import { getConnectedWpcomSitesForLocalSite } from '@studio/common/lib/connected-sites';
import { z } from 'zod/v4';
import { errorResult, resolveSite, textResult } from './utils';

export const listConnectedRemoteSitesTool = tool(
	'site_connected_remote_sites',
	'Lists the WordPress.com sites that are already connected/attached to a local Studio site. ' +
		'Use this before calling site_push to determine how to ask the user which remote site to push to. ' +
		'Returns an empty array when the user has no connections for that local site.',
	{
		nameOrPath: z.string().describe( 'The local site name or file system path' ),
	},
	async ( args ) => {
		try {
			const site = await resolveSite( args.nameOrPath );
			const connected = await getConnectedWpcomSitesForLocalSite( site.id );
			const summary = connected.map( ( s ) => ( {
				id: s.id,
				name: s.name,
				url: s.url,
				isStaging: s.isStaging,
				syncSupport: s.syncSupport,
				lastPushTimestamp: s.lastPushTimestamp,
				lastPullTimestamp: s.lastPullTimestamp,
			} ) );
			return textResult( JSON.stringify( summary, null, 2 ) );
		} catch ( error ) {
			return errorResult(
				`Failed to list connected remote sites: ${
					error instanceof Error ? error.message : String( error )
				}`
			);
		}
	}
);
