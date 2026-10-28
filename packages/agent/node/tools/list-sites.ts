import { defineTool, REMOTE_READ } from './define-tool';
import { textResult } from './utils';
import type { StudioAgentHost } from '@studio/agent/node/host';

// Each host's sites, by its key. A host that fails to list leaves the rest of
// the listing intact.
async function listHostSites( host: StudioAgentHost ) {
	return Object.fromEntries(
		await Promise.all(
			Object.values( host.remoteHosts ).flatMap( ( remoteHost ) =>
				remoteHost.sites
					? [
							remoteHost.sites.list().then( ( listing ) => [ remoteHost.sites?.listKey, listing ] ),
					  ]
					: []
			)
		)
	);
}

export const listSitesTool = defineTool(
	'site_list',
	"Lists the user's sites: local Studio sites with their name, path, URL, and running status, and the WordPress.com sites their login reaches, with their WordPress.com site IDs.",
	{},
	async ( _args, { host } ) => {
		try {
			const [ local, hosts ] = await Promise.all( [ host.sites.list(), listHostSites( host ) ] );
			return textResult( JSON.stringify( { local, ...hosts } ) );
		} catch ( error ) {
			throw new Error(
				`Failed to list sites: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	},
	{
		annotations: REMOTE_READ,
	}
);
