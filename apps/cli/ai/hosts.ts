/**
 * The hosts built into Studio, as the agent's remote hosts (see
 * `@studio/agent/node/remote-hosts`), so they are where Studio publishes.
 * WordPress.com also reaches the Pressable sites in the user's WordPress.com
 * account. Spacefast serves static copies of local sites, so it has no sites
 * for Studio to work on or pull from.
 */
import {
	wpcomApproval,
	WPCOM_HOST,
	type HostSiteListing,
	type RemoteHost,
	withTimeout,
} from '@studio/agent/node';
import { getRemoteSites } from '@studio/common/lib/remote-sites';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { isReprintPullEnabled } from '@studio/common/lib/sync/reprint-pull';
import { withWpcomDetails } from '@studio/providers';
import { spacefast } from 'cli/ai/spacefast-host';
import { getWpComSites } from 'cli/lib/api';
import { fetchSyncableSites, parseSyncOptions } from 'cli/lib/sync-api';
import { Logger } from 'cli/logger';

const errorText = ( error: unknown ) =>
	error instanceof Error ? error.message : String( error );

// A listing takes about a second; one that hangs, as a read that only the
// system's network timeout ends, fails rather than holding the call open.
const LISTING_TIMEOUT_MS = 30_000;

/** The user's WordPress.com sites that `read` lists with their token. */
async function wpcomListing(
	read: ( token: string ) => Promise< HostSiteListing[ 'sites' ] >
): Promise< HostSiteListing > {
	const token = await readAuthToken();
	if ( ! token?.accessToken ) {
		return { signedIn: false, sites: [] };
	}
	try {
		return {
			signedIn: true,
			sites: await withTimeout(
				read( token.accessToken ),
				LISTING_TIMEOUT_MS,
				'Listing WordPress.com sites'
			),
		};
	} catch ( error ) {
		return {
			signedIn: true,
			sites: [],
			error: errorText( error ),
		};
	}
}

const wpcom: RemoteHost = {
	...WPCOM_HOST,
	sites: {
		listKey: 'wordpressCom',
		list: () => wpcomListing( getWpComSites ),
		// WordPress.com's own server states what a site's plan and the user's role
		// allow, through its MCP tools.
		async facts() {
			return [];
		},
	},
	signIn: 'The user signs in to WordPress.com with /login.',
	publishable: () =>
		wpcomListing( async ( token ) =>
			( await fetchSyncableSites( token ) ).filter( ( site ) => site.syncSupport === 'syncable' )
		),
	async targets( { id: localSiteId } ) {
		const token = await readAuthToken();
		if ( ! token?.accessToken ) {
			return { signedIn: false, targets: [] };
		}
		const stored = await getRemoteSites( 'wpcom', localSiteId );
		if ( ! stored.length ) {
			return { signedIn: true, targets: [] };
		}
		try {
			const sites = withWpcomDetails( stored, await fetchSyncableSites( token.accessToken ) );
			return {
				signedIn: true,
				targets: sites.map( ( s ) => ( {
					id: s.id,
					name: s.name,
					url: s.url,
					isStaging: s.isStaging,
					isPressable: s.isPressable,
					environmentType: s.environmentType ?? null,
					syncSupport: s.syncSupport,
					lastPushTimestamp: s.lastPushTimestamp,
					lastPullTimestamp: s.lastPullTimestamp,
				} ) ),
			};
		} catch ( error ) {
			return {
				signedIn: true,
				targets: [],
				error: errorText( error ),
			};
		}
	},
	async mcpServer() {
		const token = await readAuthToken();
		return token
			? {
					url: 'https://public-api.wordpress.com/wpcom/v2/mcp/v2',
					headers: { Authorization: `Bearer ${ token.accessToken }` },
					approval: wpcomApproval,
			  }
			: undefined;
	},
	async push( site, target, options, onProgress ) {
		const { runCommand } = await import( 'cli/commands/push' );
		const pushed = await runCommand(
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
		const syncOptions = parseSyncOptions( options );
		let pulled;
		if ( isReprintPullEnabled() ) {
			const [ { runCommand }, { pullSelectionFromSyncOptions } ] = await Promise.all( [
				import( 'cli/commands/pull' ),
				import( 'cli/lib/pull/pull-selection' ),
			] );
			pulled = await runCommand(
				site.path,
				target,
				false,
				pullSelectionFromSyncOptions( syncOptions ),
				onProgress
			);
		} else {
			const { runCommand } = await import( 'cli/commands/pull-legacy' );
			pulled = await runCommand(
				site.path,
				syncOptions,
				target,
				undefined,
				new Logger( { onProgress } )
			);
		}
		return pulled
			? `Pulled ${ pulled.name } (${ pulled.url }) into "${ site.name }".`
			: 'Pull cancelled.';
	},
};

export const HOSTS = { wpcom, spacefast } as const satisfies Record< string, RemoteHost >;

export type HostId = keyof typeof HOSTS;

export const HOST_IDS = Object.keys( HOSTS ) as [ HostId, ...HostId[] ];
