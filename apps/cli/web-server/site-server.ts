import { fork } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { findSiteByFolder, getSiteUrl } from 'cli/lib/cli-config/sites';
import { isServerRunning, sendWpCliCommand } from 'cli/lib/wordpress-server-manager';
import { wdbg } from './debug';
import type { SiteData } from 'cli/lib/cli-config/core';

// Where Studio keeps local sites (same root the desktop uses).
const SITES_ROOT = path.join( os.homedir(), 'Studio' );

// The wpcom studio-code /export route (reads the agent's site from the sandbox).
const DEFAULT_EXPORT_URL = 'https://public-api.wordpress.com/wpcom/v2/studio-code/export';

// The sandbox's own SQLite DB. Skipped on overlay for now: applying it needs a
// server restart (Playground caches the connection) plus a siteurl/home rewrite
// to the broker's origin — a follow-up. Theme files alone give a live render of
// the agent's design on the broker's clean WordPress.
const SANDBOX_DB_PATH = 'wp-content/database/.ht.sqlite';

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

// Pull the agent's site files from the sandbox via the wpcom /export route.
async function exportSandboxSite( sandboxSitePath: string ): Promise< Record< string, string > > {
	const token = await readAuthToken().catch( () => null );
	if ( ! token ) {
		throw new Error( 'Not signed in to WordPress.com — run `studio auth login` first.' );
	}

	const exportUrl = process.env.STUDIO_SECEX_EXPORT_URL ?? DEFAULT_EXPORT_URL;
	const response = await fetch( exportUrl, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${ token.accessToken }`,
			'X-WPCOM-AI-Feature': 'studio-code',
			'Content-Type': 'application/json',
		},
		body: JSON.stringify( { path: sandboxSitePath } ),
	} );
	if ( ! response.ok ) {
		throw new Error( `studio-code /export failed (${ response.status })` );
	}

	const data = ( await response.json() ) as { files?: Record< string, string > };
	return data.files ?? {};
}

// Write the exported files into the local site, skipping the DB (for now) and
// anything that would escape the site directory. Returns the overlaid theme's
// slug, if any, so the caller can activate it.
async function overlayFiles(
	sitePath: string,
	files: Record< string, string >
): Promise< string | undefined > {
	const root = path.resolve( sitePath );
	let themeSlug: string | undefined;

	for ( const [ relativePath, base64 ] of Object.entries( files ) ) {
		if ( SANDBOX_DB_PATH === relativePath ) {
			continue;
		}

		const dest = path.resolve( root, relativePath );
		if ( dest !== root && ! dest.startsWith( root + path.sep ) ) {
			continue; // never write outside the site dir.
		}

		await fs.mkdir( path.dirname( dest ), { recursive: true } );
		await fs.writeFile( dest, Buffer.from( base64, 'base64' ) );

		const themeMatch = relativePath.match( /^wp-content\/themes\/([^/]+)\// );
		if ( themeMatch ) {
			themeSlug = themeMatch[ 1 ];
		}
	}

	return themeSlug;
}

/**
 * Overlay the agent's site (the most-recently-edited theme, via /export) onto
 * the broker's local site and activate that theme, so the served WordPress
 * renders what the agent built. The site is created/started if needed.
 *
 * @param sessionId        The web-server session id.
 * @param sandboxSitePath  The site's path inside the sandbox (e.g. /home/user/Studio/<name>).
 * @return The site URL.
 */
export async function syncSiteFromSandbox(
	sessionId: string,
	sandboxSitePath: string
): Promise< string > {
	const url = await serveSiteForSession( sessionId );
	const sitePath = sitePathForSession( sessionId );
	const site = await findSiteByFolder( sitePath );
	if ( ! site ) {
		throw new Error( `Could not resolve the local site for session ${ sessionId }` );
	}

	const files = await exportSandboxSite( sandboxSitePath );
	const themeSlug = await overlayFiles( sitePath, files );
	wdbg( 'site', 'overlay', { fileCount: Object.keys( files ).length, theme: themeSlug } );

	if ( themeSlug ) {
		await sendWpCliCommand( site.id, [ 'theme', 'activate', themeSlug ] ).catch( ( error ) => {
			wdbg( 'site', 'theme activate failed', { error: String( error ) } );
		} );
	}

	return url;
}
