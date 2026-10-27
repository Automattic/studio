import { HOSTS } from 'cli/ai/hosts';
import { runCommand as runListSitesCommand } from 'cli/commands/site/list';
import { defineTool, REMOTE_READ } from './define-tool';
import { captureConsoleOutput, textResult } from './utils';

async function listLocalSites(): Promise< unknown[] > {
	const output = await captureConsoleOutput( () => runListSitesCommand( 'json' ) );
	return output ? JSON.parse( output ) : [];
}

// Each host's sites, by its key. A host that fails to list leaves the rest of
// the listing intact.
async function listHostSites() {
	return Object.fromEntries(
		await Promise.all(
			Object.values( HOSTS ).flatMap( ( host ) =>
				host.sites
					? [ host.sites.list().then( ( listing ) => [ host.sites?.listKey, listing ] ) ]
					: []
			)
		)
	);
}

export const listSitesTool = defineTool(
	'site_list',
	"Lists the user's sites: local Studio sites with their name, path, URL, and running status, and the WordPress.com sites their login reaches, with their WordPress.com site IDs.",
	{},
	async () => {
		try {
			const [ local, hosts ] = await Promise.all( [ listLocalSites(), listHostSites() ] );
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
