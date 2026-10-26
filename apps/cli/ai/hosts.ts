/**
 * The hosts Studio reaches the user's sites on, besides this computer. A
 * remote site is one of a host's sites, by the host's own id for it, and what
 * Studio does with it is the host's: what the system prompt says of its sites,
 * how the user's sites on it are listed, where a site's facts come from, and
 * how a local site is published to it and pulled from it.
 *
 * The hosts here are the ones built into Studio, so they are where Studio
 * publishes. WordPress.com is the one host so far; it also reaches the
 * Pressable sites in the user's WordPress.com account.
 */
import { readAuthToken } from '@studio/common/lib/shared-config';
import { getWpComSites } from 'cli/lib/api';
import type { SyncOption, SyncSite } from '@studio/common/types/sync';
import type { SiteInfo } from 'cli/ai/types';
import type { Logger } from 'cli/logger';

/** One of the user's sites on a host. */
export interface RemoteSite {
	host: HostId;
	/** The host's id for the site. */
	id: string | number;
}

/** The sites a local site is published to on a host, as far as the host could list them. */
interface HostTargets {
	signedIn: boolean;
	targets: SyncSite[];
	error?: string;
}

/** The user's sites on a host, as far as the host could list them. */
interface HostSiteListing {
	signedIn: boolean;
	sites: Array< { id: string | number; name: string; url: string } >;
	error?: string;
}

export interface Host {
	/** The host's name, as the user knows it. */
	name: string;
	/** What the system prompt's Environment section says of the host's sites. */
	environment: string;
	/** The key the host's sites take in site_list's result. */
	listKey: string;
	/** The user's sites on the host. A failure is the listing's error. */
	list(): Promise< HostSiteListing >;
	/** The facts the agent gets about one of the host's sites, by the fact that states them. */
	facts( site: SiteInfo ): Promise< string[][] >;
	/** What a local site is published to on the host. */
	publishes: string;
	/** How the user signs in to the host. */
	signIn: string;
	/** The host's sites already connected to the local site with this Studio id. */
	targets( localSiteId: string ): Promise< HostTargets >;
	/** Replaces the target's content with the local site's. */
	push(
		sitePath: string,
		target: string,
		options: SyncOption[],
		logger: Logger< string >
	): Promise< void >;
	/** Replaces the local site's content with the target's. */
	pull(
		sitePath: string,
		target: string,
		options: SyncOption[],
		logger: Logger< string >
	): Promise< void >;
}

const wpcom: Host = {
	name: 'WordPress.com',
	environment:
		"The user's WordPress.com sites are live sites, reached through the WordPress.com REST API.",
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
	// WordPress.com's own server states what a site's plan and the user's role
	// allow, through its MCP tools.
	async facts() {
		return [];
	},
	publishes:
		"the user's WordPress.com sites, and the Pressable sites in their WordPress.com account",
	signIn: 'The user signs in to WordPress.com with /login.',
	async targets( localSiteId ) {
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
			return {
				signedIn: true,
				targets: withWpcomDetails( stored, await fetchSyncableSites( token.accessToken ) ),
			};
		} catch ( error ) {
			return {
				signedIn: true,
				targets: [],
				error: error instanceof Error ? error.message : String( error ),
			};
		}
	},
	async push( sitePath, target, options, logger ) {
		const { runCommand } = await import( 'cli/commands/push' );
		await runCommand( sitePath, options, target, logger );
	},
	async pull( sitePath, target, options, logger ) {
		const { runCommand } = await import( 'cli/commands/pull' );
		await runCommand( sitePath, options, target, undefined, logger );
	},
};

export const HOSTS = { wpcom } as const satisfies Record< string, Host >;

export type HostId = keyof typeof HOSTS;

export const HOST_IDS = Object.keys( HOSTS ) as [ HostId, ...HostId[] ];

export function hostOf( site: RemoteSite ): Host {
	return HOSTS[ site.host ];
}

/**
 * A site selection as sessions store it, which the desktop app also reads:
 * `remote` marks a WordPress.com site and `wpcomSiteId` is its id.
 */
export interface StoredSiteSelection {
	remote?: boolean;
	wpcomSiteId?: number;
}

export function remoteSiteFromStored( stored: StoredSiteSelection ): RemoteSite | undefined {
	return stored.remote === true && stored.wpcomSiteId !== undefined
		? { host: 'wpcom', id: stored.wpcomSiteId }
		: undefined;
}

export function storedFromRemoteSite( remote: RemoteSite | undefined ): StoredSiteSelection {
	return remote?.host === 'wpcom' && typeof remote.id === 'number'
		? { remote: true, wpcomSiteId: remote.id }
		: {};
}
