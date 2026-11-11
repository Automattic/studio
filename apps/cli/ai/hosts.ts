import { getConnectedWpcomSitesForLocalSite } from '@studio/common/lib/connected-sites';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { isReprintPullEnabled } from '@studio/common/lib/sync/reprint-pull';
import { fetchSyncableSites } from '@studio/common/lib/sync/sync-api';
import { withWpcomDetails } from '@studio/common/lib/sync/transform-sites';
import { runCommand as runPullCommand } from 'cli/commands/pull';
import { runCommand as runLegacyPullCommand } from 'cli/commands/pull-legacy';
import { runCommand as runPushCommand } from 'cli/commands/push';
import { getWpComSites } from 'cli/lib/api';
import { pullSelectionFromSyncOptions } from 'cli/lib/pull/pull-selection';
import { parseSyncOptions } from 'cli/lib/sync-api';
import { Logger } from 'cli/logger';
import type { RemoteHost } from '@studio/agent/node';

const wpcom: RemoteHost = {
	name: 'WordPress.com',
	sites: {
		listKey: 'wordpressCom',
		async list() {
			const token = await readAuthToken();
			if ( ! token?.accessToken ) {
				return { signedIn: false, sites: [] };
			}
			try {
				return { signedIn: true, sites: await getWpComSites( token.accessToken ) };
			} catch ( error ) {
				return {
					signedIn: true,
					sites: [],
					error: error instanceof Error ? error.message : String( error ),
				};
			}
		},
	},
	async targets( site ) {
		const stored = await getConnectedWpcomSitesForLocalSite( site.id );
		const token = await readAuthToken();
		const connected =
			stored.length && token
				? withWpcomDetails( stored, await fetchSyncableSites( token.accessToken ) )
				: [];
		return connected.map( ( s ) => ( {
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
	},
	async push( site, target, options, onProgress ) {
		const pushed = await runPushCommand(
			site.path,
			parseSyncOptions( options ),
			target,
			new Logger( { onProgress } )
		);
		return pushed
			? `Pushed "${ site.name }" to ${ pushed.name } (${ pushed.url }).`
			: 'Push cancelled.';
	},
	async pull( site, target, options, onProgress ) {
		const pulled = isReprintPullEnabled()
			? await runPullCommand(
					site.path,
					target,
					false,
					pullSelectionFromSyncOptions( parseSyncOptions( options ) ),
					onProgress
			  )
			: await runLegacyPullCommand(
					site.path,
					parseSyncOptions( options ),
					target,
					undefined,
					new Logger( { onProgress } )
			  );
		return pulled
			? `Pulled ${ pulled.name } (${ pulled.url }) into "${ site.name }".`
			: 'Pull cancelled.';
	},
	describeSite( site ) {
		return `"${ site.name }" (ID: ${ site.wpcomSiteId }) at ${ site.url } (WordPress.com)`;
	},
};

export const HOSTS: Record< string, RemoteHost > = { wpcom };
