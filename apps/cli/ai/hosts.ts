/**
 * The hosts built into Studio, as the agent's remote hosts (see
 * `@studio/agent/node/remote-hosts`), so they are where Studio publishes.
 * WordPress.com also reaches the Pressable sites in the user's WordPress.com
 * account. Spacefast serves static copies of local sites, so it has no sites
 * for Studio to work on or pull from.
 */
import { wpcomApproval, type HostSiteListing, type RemoteHost } from '@studio/agent/node';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { spacefast } from 'cli/ai/spacefast-host';
import { getWpComSites } from 'cli/lib/api';
import { parseSyncOptions } from 'cli/lib/sync-api';
import { Logger } from 'cli/logger';

/** The user's WordPress.com sites that `read` lists with their token. */
async function wpcomListing(
	read: ( token: string ) => Promise< HostSiteListing[ 'sites' ] >
): Promise< HostSiteListing > {
	const token = await readAuthToken();
	if ( ! token?.accessToken ) {
		return { signedIn: false, sites: [] };
	}
	try {
		return { signedIn: true, sites: await read( token.accessToken ) };
	} catch ( error ) {
		return {
			signedIn: true,
			sites: [],
			error: error instanceof Error ? error.message : String( error ),
		};
	}
}

const wpcom: RemoteHost = {
	name: 'WordPress.com',
	environment:
		"The user's WordPress.com sites are live sites, reached through the WordPress.com REST API.",
	sites: {
		listKey: 'wordpressCom',
		list: () => wpcomListing( getWpComSites ),
		// WordPress.com's own server states what a site's plan and the user's role
		// allow, through its MCP tools.
		async facts() {
			return [];
		},
	},
	publishes:
		"the user's WordPress.com sites, and the Pressable sites in their WordPress.com account",
	signIn: 'The user signs in to WordPress.com with /login.',
	publishable: () =>
		wpcomListing( async ( token ) => {
			const { fetchSyncableSites } = await import( 'cli/lib/sync-api' );
			const sites = await fetchSyncableSites( token );
			return sites.filter( ( site ) => site.syncSupport === 'syncable' );
		} ),
	newSiteUrl( name ) {
		const url = new URL( 'https://wordpress.com/setup/new-hosted-site' );
		url.searchParams.set( 'ref', 'studio' );
		url.searchParams.set( 'section', 'studio-sync' );
		url.searchParams.set( 'showDomainStep', 'true' );
		url.searchParams.set( 'new', name );
		return url.toString();
	},
	async targets( { id: localSiteId } ) {
		const [ { getConnectedWpcomSitesForLocalSite }, { fetchSyncableSites }, { withWpcomDetails } ] =
			await Promise.all( [
				import( '@studio/common/lib/connected-sites' ),
				import( '@studio/common/lib/sync/sync-api' ),
				import( '@studio/common/lib/sync/transform-sites' ),
			] );
		const token = await readAuthToken();
		if ( ! token?.accessToken ) {
			return { signedIn: false, targets: [] };
		}
		const stored = await getConnectedWpcomSitesForLocalSite( localSiteId );
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
				error: error instanceof Error ? error.message : String( error ),
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
		const { runCommand } = await import( 'cli/commands/pull' );
		const pulled = await runCommand(
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
};

export const HOSTS = { wpcom, spacefast } as const satisfies Record< string, RemoteHost >;

export type HostId = keyof typeof HOSTS;

export const HOST_IDS = Object.keys( HOSTS ) as [ HostId, ...HostId[] ];
