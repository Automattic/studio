/**
 * The hosts built into Studio, as the agent's remote hosts (see
 * `@studio/agent/shared/remote-hosts`): the sites Studio works on besides
 * local ones. Publishing to any provider's sites is the host's `sync`.
 */
import {
	wpcomApproval,
	WPCOM_HOST,
	type HostSiteListing,
	type RemoteHost,
	withTimeout,
} from '@studio/agent/node';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { getWpComSites } from 'cli/lib/api';

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
};

export const HOSTS = { wpcom } as const satisfies Record< string, RemoteHost >;

export type HostId = keyof typeof HOSTS;

export const HOST_IDS = Object.keys( HOSTS ) as [ HostId, ...HostId[] ];
