/**
 * The hosts Studio reaches the user's sites on, besides this computer. A
 * remote site is one of a host's sites, by the host's own id for it, and what
 * Studio does with it is the host's: what the system prompt says of its sites,
 * how the user's sites on it are listed, where a site's facts come from, and
 * the MCP server its tools come from. Publishing to a provider's sites is
 * `StudioAgentHost.sync`. The app running the agent provides its hosts
 * (`StudioAgentHost.remoteHosts`).
 */
import type { SiteInfo } from './types';

/** A question the harness asks the user before a call that needs their yes. */
export interface Confirmation {
	question: string;
	consequence: string;
	/** What follows from No, where it is more than nothing changing. */
	declined?: string;
}

/**
 * How an MCP server asks for the user's approval of a call it won't run
 * without it. The harness asks the user, so the model never sets it.
 */
export interface McpApproval {
	// The boolean argument that tells the server the user approved the call.
	argument: string;
	// The question in a result that asks for approval, if the result asks.
	request( result: string ): Confirmation | undefined;
}

/** A host's own MCP server, for the signed-in user. */
export interface HostMcpServer {
	url: string;
	headers?: Record< string, string >;
	approval?: McpApproval;
}

/** One of the user's sites on a host. */
export interface RemoteSite {
	/** The host's key in `StudioAgentHost.remoteHosts`. */
	host: string;
	/** The host's id for the site. */
	id: string | number;
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
	/** The host's own MCP server for the signed-in user, served as `<host id>_<tool>`. */
	mcpServer(): Promise< HostMcpServer | undefined >;
}

/**
 * What WordPress.com is to the agent, the same in every app; each app reaches
 * it its own way for the rest. It also reaches the Pressable sites in the
 * user's WordPress.com account.
 */
export const WPCOM_HOST = {
	name: 'WordPress.com',
	environment:
		"The user's WordPress.com sites are live sites, reached through the WordPress.com REST API.",
} satisfies Partial< RemoteHost >;

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
