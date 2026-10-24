import { readAuthToken } from '@studio/common/lib/shared-config';
import { runCommand as runListSitesCommand } from 'cli/commands/site/list';
import { getWpComSites } from 'cli/lib/api';
import { defineTool, REMOTE_READ } from './define-tool';
import { captureConsoleOutput, textResult } from './utils';

async function listLocalSites(): Promise< unknown[] > {
	const output = await captureConsoleOutput( () => runListSitesCommand( 'json' ) );
	return output ? JSON.parse( output ) : [];
}

// The WordPress.com sites the stored login can reach. A failure here leaves the
// local listing intact.
async function listWpcomSites() {
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
}

export const listSitesTool = defineTool(
	'site_list',
	"Lists the user's sites: local Studio sites with their name, path, URL, and running status, and the WordPress.com sites their login reaches, with their WordPress.com site IDs.",
	{},
	async () => {
		try {
			const [ local, wordpressCom ] = await Promise.all( [ listLocalSites(), listWpcomSites() ] );
			return textResult( JSON.stringify( { local, wordpressCom } ) );
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
