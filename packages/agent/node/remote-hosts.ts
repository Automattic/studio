/**
 * The hosts Studio reaches the user's sites on, besides this computer. A
 * remote site is one of a host's sites, by the host's own id for it, and what
 * Studio does with it is the host's: what the system prompt says of its sites,
 * how the user's sites on it are listed, where a site's facts come from, how a
 * local site is published to it and pulled from it, and the MCP server its
 * tools come from. The app running the agent provides its hosts
 * (`StudioAgentHost.remoteHosts`).
 */
import type { HostSite, ProgressCallback } from './host';
import type { McpApproval, McpServerSpec } from './runtime/mcp-tools';
import type { SiteInfo } from './types';

/** One of the user's sites on a host. */
export interface RemoteSite {
	/** The host's key in `StudioAgentHost.remoteHosts`. */
	host: string;
	/** The host's id for the site. */
	id: string | number;
}

/** A site a local site is published to, with what the host says of it. */
type HostTarget = { id: string | number; name: string; url: string } & Record< string, unknown >;

/** The sites a local site is published to on a host, as far as the host could list them. */
interface HostTargets {
	signedIn: boolean;
	targets: HostTarget[];
	error?: string;
}

/** The user's sites on a host, as far as the host could list them. */
export interface HostSiteListing {
	signedIn: boolean;
	sites: Array< { id: string | number; name: string; url: string } >;
	error?: string;
}

export interface RemoteHost {
	/** The host's name, as the user knows it. */
	name: string;
	/** What the system prompt's Environment section says of the host's sites. */
	environment: string;
	/** The user's sites on the host, for a host whose sites Studio works on. */
	sites?: {
		/** The key the host's sites take in site_list's result. */
		listKey: string;
		/** The user's sites on the host. A failure is the listing's error. */
		list(): Promise< HostSiteListing >;
		/** The facts the agent gets about one of the host's sites, by the fact that states them. */
		facts( site: SiteInfo ): Promise< string[][] >;
	};
	/** What a local site is published to on the host. */
	publishes: string;
	/** The sites on the host the local site at `sitePath` can be published to. */
	publishable( sitePath: string ): Promise< HostSiteListing >;
	/** Where the user makes a new site on the host, for a local site of this name. */
	newSiteUrl( name: string ): string;
	/** How the user signs in to the host. */
	signIn: string;
	/** The host's sites already connected to this local site. */
	targets( site: { id: string; path: string } ): Promise< HostTargets >;
	/** The host's own MCP server for the signed-in user, served as `<host id>_<tool>`. */
	mcpServer(): Promise< Pick< McpServerSpec, 'url' | 'headers' | 'approval' > | undefined >;
	/**
	 * Replaces the target's content with the local site's, with the sync
	 * `options` (comma-separated). Returns what it did, for the agent.
	 */
	push(
		site: HostSite,
		target: string,
		options: string,
		onProgress: ProgressCallback
	): Promise< string >;
	/** Replaces the local site's content with the target's, for a host that serves WordPress. */
	pull?(
		site: HostSite,
		target: string,
		options: string,
		onProgress: ProgressCallback
	): Promise< string >;
}

const WPCOM_PROMPT = '\n\nWhat to tell the user: ';

// WordPress.com refuses a write that needs approval with "Approval required."
// and the question for the user, then runs it again with user_confirmed.
export const wpcomApproval: McpApproval = {
	argument: 'user_confirmed',
	request( result ) {
		const [ refusal, prompt ] = result.split( WPCOM_PROMPT );
		if ( ! refusal.startsWith( 'Approval required.' ) || ! prompt ) {
			return undefined;
		}
		const [ question, ...details ] = prompt.split( '\n\n' );
		return {
			question,
			consequence: details.join( ' ' ) || 'Changes the live site.',
		};
	},
};

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
