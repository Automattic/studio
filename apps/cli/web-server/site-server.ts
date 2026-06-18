import { fork } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { findSiteByFolder, getSiteUrl } from 'cli/lib/cli-config/sites';
import { isServerRunning } from 'cli/lib/wordpress-server-manager';
import { wdbg } from './debug';
import type { SiteData } from 'cli/lib/cli-config/core';

// Where Studio keeps local sites (same root the desktop uses).
const SITES_ROOT = path.join( os.homedir(), 'Studio' );

/**
 * The broker serves the agent's site itself, with the SAME WordPress Playground
 * server the desktop runs — a Node process, where PHP-WASM works. (It does NOT
 * boot reliably inside the SecEx sandbox, so the sandbox only runs the agent;
 * serving moves here.) The browser then iframes a real, running WordPress.
 */

// Run a `studio <args>` subcommand in a child of the same CLI bundle the
// web-server runs from, resolving on a clean exit. `--experimental-wasm-jspi`
// matches how the agent is forked — the PHP-WASM server needs it.
function runCli( args: string[] ): Promise< void > {
	return new Promise( ( resolve, reject ) => {
		const child = fork( process.argv[ 1 ], args, {
			stdio: [ 'ignore', 'inherit', 'inherit', 'ipc' ],
			execArgv: [ '--experimental-wasm-jspi' ],
			env: { ...process.env },
		} );
		child.on( 'error', reject );
		child.on( 'exit', ( code ) =>
			0 === code
				? resolve()
				: reject( new Error( `studio ${ args.join( ' ' ) } exited with ${ code }` ) )
		);
	} );
}

// The local site directory backing a web-server session.
function sitePathForSession( sessionId: string ): string {
	return path.join( SITES_ROOT, `studio-web-${ sessionId.slice( 0, 8 ) }` );
}

/**
 * Ensure a real local WordPress site exists and is running for this session, and
 * return its URL for the browser to iframe. The site persists across runs in the
 * daemon, so repeated calls just confirm it's up.
 *
 * @param sessionId The web-server session id.
 * @return The site URL (e.g. http://localhost:8881).
 */
export async function serveSiteForSession( sessionId: string ): Promise< string > {
	const sitePath = sitePathForSession( sessionId );
	const name = path.basename( sitePath );

	let site: SiteData | undefined = await findSiteByFolder( sitePath );
	if ( ! site ) {
		wdbg( 'site', 'create', { name, sitePath } );
		await runCli( [
			'site',
			'create',
			'--name',
			name,
			'--path',
			sitePath,
			'--skip-browser',
			'--skip-log-details',
		] );
		site = await findSiteByFolder( sitePath );
	} else if ( ! ( await isServerRunning( site.id ) ) ) {
		wdbg( 'site', 'start', { name } );
		await runCli( [ 'site', 'start', '--path', sitePath ] );
		site = await findSiteByFolder( sitePath );
	}

	if ( ! site ) {
		throw new Error( `Could not resolve the local site for session ${ sessionId }` );
	}

	const url = getSiteUrl( site );
	wdbg( 'site', 'serving', { name, url } );
	return url;
}
