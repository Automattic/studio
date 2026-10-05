import { spawn } from 'child_process';
import { portFinder } from '@studio/common/lib/port-finder';
import { readUiServerState } from 'cli/lib/ui-server-state';

const START_TIMEOUT_MS = 30_000;

async function isHealthy( url: string ): Promise< boolean > {
	try {
		const response = await fetch( `${ url }/api/health`, { signal: AbortSignal.timeout( 2_000 ) } );
		return response.ok;
	} catch {
		return false;
	}
}

// Reuses the `studio ui` server the user already runs, or starts one in the
// background that outlives this MCP session, like one started by hand.
export async function ensureStudioUiServer(): Promise< string > {
	const state = await readUiServerState();
	if ( state && ( await isHealthy( state.url ) ) ) {
		return state.url;
	}
	const port = await portFinder.getOpenPort( 8081 );
	const child = spawn(
		process.execPath,
		[ process.argv[ 1 ], 'ui', '--no-open', '--port', String( port ) ],
		{ detached: true, stdio: 'ignore', env: process.env }
	);
	child.unref();
	const url = `http://localhost:${ port }`;
	const deadline = Date.now() + START_TIMEOUT_MS;
	while ( Date.now() < deadline ) {
		if ( await isHealthy( url ) ) {
			return url;
		}
		await new Promise( ( resolve ) => setTimeout( resolve, 500 ) );
	}
	throw new Error( `The Studio UI did not start on ${ url }.` );
}

export async function reloadSitePreview( url: string, siteId: string ): Promise< void > {
	const response = await fetch(
		`${ url }/api/sites/${ encodeURIComponent( siteId ) }/preview/reload`,
		{ method: 'POST' }
	);
	if ( ! response.ok ) {
		throw new Error(
			`The Studio UI at ${ url } did not reload the preview (${ response.status }).`
		);
	}
}
