import { defineTool, REMOTE_READ } from './define-tool';
import { textResult } from './utils';

export const listSitesTool = defineTool(
	'site_list',
	"Lists the user's sites: local Studio sites with their name, path, URL, and running status, and the WordPress.com sites their login reaches, with their WordPress.com site IDs.",
	{},
	async ( _args, { host } ) => {
		try {
			const [ local, listings ] = await Promise.all( [
				host.sites.list(),
				Promise.all(
					Object.values( host.remoteHosts )
						.filter( ( remote ) => remote.sites )
						.map( async ( remote ) => [ remote.sites!.listKey, await remote.sites!.list() ] )
				),
			] );
			return textResult( JSON.stringify( { local, ...Object.fromEntries( listings ) } ) );
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
