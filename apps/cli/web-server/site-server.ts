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

// The sandbox's own SQLite DB. When present in the export we apply it (so the
// agent's content, active theme, and customizations show), but only while the
// server is stopped — Playground caches the connection — and we then repoint the
// DB's siteurl/home from the sandbox origin to the broker's.
const SANDBOX_DB_PATH = 'wp-content/database/.ht.sqlite';

/**
 * The broker serves the agent's site itself, with the SAME WordPress Playground
 * server the desktop runs — a Node process, where PHP-WASM works. (It does NOT
 * boot reliably inside the SecEx sandbox, so the sandbox only runs the agent;
 * serving moves here.) The browser then iframes a real, running WordPress.
 */

export interface ServedSite {
	sessionId: string;
	site: SiteData;
	url: string;
}

// Sites the broker is currently serving, keyed by web-server session id. The
// daemon is long-lived, so this stays warm across requests. The web-server reads
// it to (a) list these as running sites via `/api/sites` and (b) bind a session
// to its served site (`ownerSitePath`), which is exactly how the shared UI's
// site-preview widget discovers a site to render — no Studio-Web-specific UI.
const servedSites = new Map< string, ServedSite >();

export function listServedSites(): ServedSite[] {
	return [ ...servedSites.values() ];
}

export function getServedSite( sessionId: string ): ServedSite | undefined {
	return servedSites.get( sessionId );
}

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
	servedSites.set( sessionId, { sessionId, site, url } );
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

// Write the exported files into the local site, skipping the DB unless
// `includeDb` is set, and never writing outside the site directory. Returns the
// overlaid theme's slug, if any, so the caller can activate it when no DB came
// across (the DB already records the active theme).
async function overlayFiles(
	sitePath: string,
	files: Record< string, string >,
	includeDb: boolean,
	brokerUrl: string
): Promise< string | undefined > {
	const root = path.resolve( sitePath );
	let themeSlug: string | undefined;

	for ( const [ relativePath, base64 ] of Object.entries( files ) ) {
		const isDb = SANDBOX_DB_PATH === relativePath;
		if ( isDb && ! includeDb ) {
			continue;
		}

		const dest = path.resolve( root, relativePath );
		if ( dest !== root && ! dest.startsWith( root + path.sep ) ) {
			continue; // never write outside the site dir.
		}

		const raw = Buffer.from( base64, 'base64' );
		const buffer = isDb ? repointDbBuffer( raw, brokerUrl ) : raw;
		await fs.mkdir( path.dirname( dest ), { recursive: true } );
		await fs.writeFile( dest, buffer );

		const themeMatch = relativePath.match( /^wp-content\/themes\/([^/]+)\// );
		if ( themeMatch ) {
			themeSlug = themeMatch[ 1 ];
		}
	}

	return themeSlug;
}

// The exported DB carries the sandbox's own origin in siteurl/home (and any
// hard-coded links), so a freshly-loaded copy would 301 the browser to the
// unreachable sandbox URL. The broker's forked WordPress server doesn't accept
// WP-CLI over IPC, so we repoint by rewriting the origin directly in the SQLite
// bytes before writing the file. This is only safe when the two origins are the
// same byte length (SQLite/PHP length prefixes stay valid) — both are
// `http://localhost:<4-digit port>` in practice, so they match; if they ever
// don't, we skip the rewrite rather than corrupt the DB.
function repointDbBuffer( db: Buffer, brokerUrl: string ): Buffer {
	const text = db.toString( 'latin1' );
	const origins = text.match( /https?:\/\/localhost:\d+/g );
	if ( ! origins ) {
		return db;
	}
	// The real siteurl recurs throughout the DB; a spurious match (a URL glued to
	// a trailing number, where greedy `\d+` overshoots the port) appears once.
	// Pick the most frequent origin so we rewrite the true one.
	const counts = new Map< string, number >();
	for ( const origin of origins ) {
		counts.set( origin, ( counts.get( origin ) ?? 0 ) + 1 );
	}
	const sandboxUrl = [ ...counts.entries() ].sort( ( a, b ) => b[ 1 ] - a[ 1 ] )[ 0 ][ 0 ];
	if ( sandboxUrl === brokerUrl ) {
		return db;
	}
	if ( sandboxUrl.length !== brokerUrl.length ) {
		wdbg( 'site', 'db repoint skipped (origin length mismatch)', { sandboxUrl, brokerUrl } );
		return db;
	}
	wdbg( 'site', 'db repoint', { from: sandboxUrl, to: brokerUrl } );
	return Buffer.from( text.split( sandboxUrl ).join( brokerUrl ), 'latin1' );
}

/**
 * Overlay the agent's site (theme files + SQLite DB, via /export) onto the
 * broker's local site so the served WordPress renders exactly what the agent
 * built — content, active theme, and customizations included. The site is
 * created/started if needed. Applying the DB requires stopping the server first
 * (Playground caches the connection) and repointing its origin afterwards.
 *
 * @param sessionId        The web-server session id.
 * @param sandboxSitePath  The site's path inside the sandbox (e.g. /home/user/Studio/<name>).
 * @return The site URL.
 */
export async function syncSiteFromSandbox(
	sessionId: string,
	sandboxSitePath: string
): Promise< string > {
	const brokerUrl = await serveSiteForSession( sessionId );
	const sitePath = sitePathForSession( sessionId );
	let site = await findSiteByFolder( sitePath );
	if ( ! site ) {
		throw new Error( `Could not resolve the local site for session ${ sessionId }` );
	}

	const files = await exportSandboxSite( sandboxSitePath );
	const hasDb = Object.prototype.hasOwnProperty.call( files, SANDBOX_DB_PATH );
	wdbg( 'site', 'overlay', { fileCount: Object.keys( files ).length, db: hasDb } );

	// Replace files (and the DB) with the server stopped — a running Playground
	// holds the SQLite connection open and would never see a swapped DB file. The
	// DB's origin is repointed to the broker inside overlayFiles before it lands.
	if ( await isServerRunning( site.id ) ) {
		await runCli( [ 'site', 'stop', '--path', sitePath ] );
	}
	const themeSlug = await overlayFiles( sitePath, files, hasDb, brokerUrl );
	await runCli( [ 'site', 'start', '--path', sitePath ] );

	site = ( await findSiteByFolder( sitePath ) ) ?? site;
	const liveUrl = getSiteUrl( site );
	servedSites.set( sessionId, { sessionId, site, url: liveUrl } );

	// Without a DB, the active theme isn't carried over — activate the overlaid
	// one so at least the design renders. (Best-effort: the broker's forked
	// server may not accept WP-CLI; failures are non-fatal.)
	if ( ! hasDb && themeSlug ) {
		await sendWpCliCommand( site.id, [ 'theme', 'activate', themeSlug ] ).catch( ( error ) => {
			wdbg( 'site', 'theme activate failed', { error: String( error ) } );
		} );
	}

	return liveUrl;
}
