import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { DEFAULT_PHP_VERSION } from '@studio/common/constants';
import { getConfigDirectory } from '@studio/common/lib/well-known-paths';
import { getPhpBinaryPath, getWpLspPath } from 'cli/lib/dependency-management/paths';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';
import { LspClient, toFileUri } from './client';

const IDLE_SHUTDOWN_MS = 10 * 60_000;
const REAP_INTERVAL_MS = 60_000;
const INITIALIZE_TIMEOUT_MS = 30_000;

// Mirrors the launch recipe wp-lsp ships in its own `.lsp.json`: pin errors to
// stderr and neutralise php.ini settings that could print to stdout, which the
// client reads as protocol frames.
const PHP_GUARD_ARGS = [
	'-d',
	'display_errors=stderr',
	'-d',
	'auto_prepend_file=',
	'-d',
	'auto_append_file=',
	'-d',
	'output_buffering=0',
	'-d',
	'memory_limit=768M',
];

const INITIALIZATION_OPTIONS = {
	logLevel: 'warn',
	indexCore: false,
	indexVendor: false,
	checkHookNames: true,
	checkTextDomain: true,
};

export interface LspServer {
	client: LspClient;
	siteRoot: string;
	lastUsedAt: number;
	// False until the first operation completes: the initial index blocks
	// requests, so first callers should allow extra time.
	warmedUp: boolean;
}

interface LspServerEntry {
	promise: Promise< LspServer >;
	child?: ChildProcess;
}

const servers = new Map< string, LspServerEntry >();
let reapTimer: NodeJS.Timeout | undefined;
let exitHookInstalled = false;

function resolveWpLspRoot(): string | null {
	const override = process.env.STUDIO_WP_LSP_PATH?.trim();
	const root = override || getWpLspPath();
	return fs.existsSync( path.join( root, 'bin', 'wp-lsp' ) ) ? root : null;
}

function resolvePhpBinary(): string | null {
	const override = process.env.STUDIO_WP_LSP_PHP?.trim();
	if ( override ) {
		return override;
	}
	const bundled = getPhpBinaryPath( DEFAULT_PHP_VERSION );
	if ( fs.existsSync( bundled ) ) {
		return bundled;
	}
	// Fall back to PATH resolution; a missing binary surfaces as a spawn error.
	return 'php';
}

export function isWpLspAvailable(): boolean {
	return resolveWpLspRoot() !== null;
}

/**
 * Map an absolute file path to the root of the Studio site containing it.
 * Agent file tools are rooted at `STUDIO_SITES_ROOT`, so the site is the
 * first path segment below it. Returns null for paths outside the sites root
 * (remote-session scratch files, arbitrary absolute paths).
 */
export function getSiteRootForFile( absolutePath: string ): string | null {
	const relative = path.relative( STUDIO_SITES_ROOT, absolutePath );
	if ( ! relative || relative.startsWith( '..' ) || path.isAbsolute( relative ) ) {
		return null;
	}
	const [ siteFolder ] = relative.split( path.sep );
	if ( ! siteFolder ) {
		return null;
	}
	const siteRoot = path.join( STUDIO_SITES_ROOT, siteFolder );
	return fs.existsSync( siteRoot ) ? siteRoot : null;
}

export async function getLspServerForSiteRoot( siteRoot: string ): Promise< LspServer | null > {
	const key = path.resolve( siteRoot );
	const existing = servers.get( key );
	if ( existing ) {
		try {
			const server = await existing.promise;
			if ( ! server.client.isDisposed() ) {
				server.lastUsedAt = Date.now();
				return server;
			}
		} catch {
			// Fall through and respawn below.
		}
		servers.delete( key );
	}

	const wpLspRoot = resolveWpLspRoot();
	if ( ! wpLspRoot ) {
		return null;
	}

	const entry = {} as LspServerEntry;
	entry.promise = startServer( key, wpLspRoot, ( child ) => {
		entry.child = child;
	} );
	servers.set( key, entry );
	ensureLifecycleHooks();

	try {
		return await entry.promise;
	} catch {
		if ( servers.get( key ) === entry ) {
			servers.delete( key );
		}
		return null;
	}
}

async function startServer(
	siteRoot: string,
	wpLspRoot: string,
	setChild: ( child: ChildProcess ) => void
): Promise< LspServer > {
	const phpBinary = resolvePhpBinary();
	if ( ! phpBinary ) {
		throw new Error( 'wp-lsp: no PHP binary available' );
	}
	const cacheDir = path.join( getConfigDirectory(), 'wp-lsp-cache' );
	fs.mkdirSync( cacheDir, { recursive: true } );

	const child = spawn(
		phpBinary,
		[ ...PHP_GUARD_ARGS, path.join( wpLspRoot, 'bin', 'wp-lsp' ), '--stdio' ],
		{
			cwd: siteRoot,
			env: { ...process.env, WP_LSP_CACHE_DIR: cacheDir },
			stdio: [ 'pipe', 'pipe', 'ignore' ],
		}
	);
	setChild( child );
	// The server must never keep the CLI process alive on its own: unref the
	// child and its pipes so a forgotten server can't block a natural exit.
	child.unref();
	( child.stdin as unknown as { unref?: () => void } ).unref?.();
	( child.stdout as unknown as { unref?: () => void } ).unref?.();

	const client = new LspClient( child.stdin!, child.stdout! );
	const server: LspServer = { client, siteRoot, lastUsedAt: Date.now(), warmedUp: false };

	child.on( 'error', ( error ) => {
		client.dispose( `failed to start (${ error.message })` );
		deleteIfCurrent( siteRoot, client );
	} );
	child.on( 'exit', ( code ) => {
		client.dispose( `server exited with code ${ code ?? 'unknown' }` );
		deleteIfCurrent( siteRoot, client );
	} );

	const spawnFailure = new Promise< never >( ( _, reject ) => {
		child.once( 'error', ( error ) =>
			reject( new Error( `wp-lsp: failed to start: ${ error.message }` ) )
		);
		child.once( 'exit', ( code ) =>
			reject( new Error( `wp-lsp: exited during startup with code ${ code ?? 'unknown' }` ) )
		);
	} );

	await Promise.race( [
		( async () => {
			await client.request(
				'initialize',
				{
					processId: process.pid,
					rootUri: toFileUri( siteRoot ),
					capabilities: {},
					initializationOptions: INITIALIZATION_OPTIONS,
				},
				INITIALIZE_TIMEOUT_MS
			);
			client.notify( 'initialized', {} );
		} )(),
		spawnFailure,
	] );

	return server;
}

function deleteIfCurrent( siteRoot: string, client: LspClient ): void {
	const key = path.resolve( siteRoot );
	const entry = servers.get( key );
	if ( ! entry ) {
		return;
	}
	entry.promise.then(
		( server ) => {
			if ( server.client === client ) {
				servers.delete( key );
			}
		},
		() => servers.delete( key )
	);
}

function ensureLifecycleHooks(): void {
	if ( ! reapTimer ) {
		reapTimer = setInterval( reapIdleServers, REAP_INTERVAL_MS );
		reapTimer.unref?.();
	}
	if ( ! exitHookInstalled ) {
		exitHookInstalled = true;
		process.once( 'exit', () => {
			for ( const entry of servers.values() ) {
				entry.child?.kill();
			}
		} );
	}
}

function reapIdleServers(): void {
	const now = Date.now();
	for ( const [ key, entry ] of servers ) {
		entry.promise.then(
			( server ) => {
				if ( now - server.lastUsedAt > IDLE_SHUTDOWN_MS ) {
					shutdownEntry( entry, server );
					if ( servers.get( key ) === entry ) {
						servers.delete( key );
					}
				}
			},
			() => servers.delete( key )
		);
	}
}

function shutdownEntry( entry: LspServerEntry, server: LspServer ): void {
	try {
		server.client.notify( 'exit' );
	} catch {
		// The process is killed below regardless.
	}
	server.client.dispose( 'shut down' );
	entry.child?.kill();
}

export async function shutdownAllLspServers(): Promise< void > {
	const entries = [ ...servers.values() ];
	servers.clear();
	await Promise.all(
		entries.map( async ( entry ) => {
			try {
				const server = await entry.promise;
				shutdownEntry( entry, server );
			} catch {
				entry.child?.kill();
			}
		} )
	);
}
