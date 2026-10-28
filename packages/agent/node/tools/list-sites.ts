import { defineTool, REMOTE_READ } from './define-tool';
import { textResult } from './utils';
import type { StudioAgentHost } from '@studio/agent/node/host';

// The WordPress.com sites the stored login can reach. A failure here leaves the
// local listing intact.
async function listWpcomSites( host: StudioAgentHost ) {
	const token = await host.wpcom.token();
	if ( ! token ) {
		return { signedIn: false, sites: [] };
	}
	try {
		return { signedIn: true, sites: await host.wpcom.sites( token ) };
	} catch ( error ) {
		return {
			signedIn: true,
			sites: [],
			error: error instanceof Error ? error.message : String( error ),
		};
	}
}

export const listSitesTool = defineTool(
	'site_list',
	"Lists the user's sites: local Studio sites with their name, path, URL, and running status, and the WordPress.com sites their login reaches, with their WordPress.com site IDs.",
	{},
	async ( _args, { host } ) => {
		try {
			const [ local, wordpressCom ] = await Promise.all( [
				host.sites.list(),
				listWpcomSites( host ),
			] );
			return textResult( JSON.stringify( { local, wordpressCom } ) );
		} catch ( error ) {
			throw new Error(
				`Failed to list sites: ${ error instanceof Error ? error.message : String( error ) }`
			);
		}
	},
	{
		promptSnippet: 'List local and WordPress.com sites with their status',
		annotations: REMOTE_READ,
	}
);
