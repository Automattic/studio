/**
 * Proxy Server for WordPress Studio CLI
 *
 * This runs as part of the CLI process when `studio proxy start` is called.
 * PM2 manages this CLI process to keep the proxy running persistently.
 *
 * The proxy listens on ports 80 (HTTP) and 443 (HTTPS) and routes requests
 * to local WordPress sites based on the Host header.
 */

import http from 'http';
import https from 'https';
import { watch, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSecureContext } from 'node:tls';
import { domainToASCII } from 'node:url';
import httpProxy from 'http-proxy';

interface SiteDetails {
	id: string;
	name: string;
	port: number;
	running: boolean;
	customDomain?: string;
	enableHttps?: boolean;
	tlsKey?: string;
	tlsCert?: string;
}

let httpProxyServer: http.Server | null = null;
let httpsProxyServer: https.Server | null = null;
let isHttpProxyRunning = false;
let isHttpsProxyRunning = false;

// Cache for site lookups
let sitesCache: SiteDetails[] = [];
let lastLoadTime = 0;
const CACHE_TTL = 5000; // 5 seconds

const proxy = httpProxy.createProxyServer();

// Setup error handling for the proxy
proxy.on( 'error', ( err, req, res ) => {
	console.error( '[Proxy Error]', err.message );
	if ( res && res instanceof http.ServerResponse ) {
		res.writeHead( 500, { 'Content-Type': 'text/plain' } );
		res.end( 'Proxy error: ' + err.message );
	}
} );

/**
 * Get the user data file path
 */
function getUserDataFilePath(): string {
	// Use the appdata path passed from the CLI
	// This is necessary because when running as root, we can't reliably calculate the user's appdata path
	if ( process.env.STUDIO_APPDATA_PATH ) {
		return process.env.STUDIO_APPDATA_PATH;
	}

	// Fallback: try to calculate it ourselves (for backwards compatibility)
	const homeDir = process.env.STUDIO_USER_HOME || os.homedir();
	const platform = process.platform;

	let appDataPath: string;
	if ( platform === 'darwin' ) {
		appDataPath = path.join( homeDir, 'Library/Application Support/Studio' );
	} else if ( platform === 'win32' ) {
		appDataPath = path.join( homeDir, 'AppData/Roaming/Studio' );
	} else {
		appDataPath = path.join( homeDir, '.config/Studio' );
	}

	return path.join( appDataPath, 'appdata-v1.json' );
}

/**
 * Load sites from user data file
 */
function loadUserDataSync(): SiteDetails[] {
	const filePath = getUserDataFilePath();

	try {
		const asString = readFileSync( filePath, 'utf-8' );
		const parsed = JSON.parse( asString );
		return parsed.sites || [];
	} catch ( err ) {
		if ( ( err as NodeJS.ErrnoException ).code === 'ENOENT' ) {
			return [];
		}
		console.error( '[Proxy] Failed to load user data:', err );
		return [];
	}
}

/**
 * Load sites from user data with caching
 */
function loadSites(): SiteDetails[] {
	const now = Date.now();
	if ( sitesCache.length > 0 && now - lastLoadTime < CACHE_TTL ) {
		return sitesCache;
	}

	try {
		sitesCache = loadUserDataSync();
		lastLoadTime = now;
		return sitesCache;
	} catch ( error ) {
		console.error( '[Proxy] Error loading user data:', error );
		return sitesCache; // Return stale cache on error
	}
}

/**
 * Force reload of sites cache (called when file watcher detects changes)
 */
function invalidateCache() {
	sitesCache = [];
	lastLoadTime = 0;
}

/**
 * Gets the site details for a given domain
 */
function getSiteByHost( domain: string ): SiteDetails | null {
	try {
		const sites = loadSites();
		const site = sites.find(
			( site ) => domainToASCII( site.customDomain ?? '' ) === domainToASCII( domain )
		);
		return site ?? null;
	} catch ( error ) {
		console.error( '[Proxy] Error looking up domain:', error );
		return null;
	}
}

/**
 * Health check endpoint
 */
function handleHealthCheck( res: http.ServerResponse ) {
	res.writeHead( 200, { 'Content-Type': 'application/json' } );
	res.end(
		JSON.stringify( {
			status: 'ok',
			http: isHttpProxyRunning,
			https: isHttpsProxyRunning,
			timestamp: Date.now(),
		} )
	);
}

/**
 * Common handler for both HTTP and HTTPS requests
 */
function handleProxyRequest(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	isHttps: boolean
) {
	// Health check endpoint
	if ( req.url === '/__studio_health' ) {
		return handleHealthCheck( res );
	}

	const host = req.headers.host?.split( ':' )[ 0 ]; // Remove port if present

	if ( ! host ) {
		console.log( '[Proxy] No host header found' );
		res.writeHead( 404, { 'Content-Type': 'text/plain' } );
		res.end( 'No host header found' );
		return;
	}

	const site = getSiteByHost( host );
	if ( ! site ) {
		console.log( `[Proxy] Domain not found: ${ host }` );
		res.writeHead( 404, { 'Content-Type': 'text/plain' } );
		res.end( `Domain not found: ${ host }` );
		return;
	}

	// Note: We don't check site.running here because that field is not persisted to disk
	// If the site is stopped, the proxy connection to localhost:port will fail naturally

	// If we're on HTTP and site has HTTPS enabled, redirect to HTTPS
	if ( ! isHttps && site.enableHttps ) {
		res.writeHead( 301, {
			Location: `https://${ host }${ req.url }`,
		} );
		res.end();
		return;
	}

	const headers: Record< string, string > = {};

	if ( isHttps ) {
		headers[ 'X-Forwarded-Proto' ] = 'https';
	}

	proxy.web( req, res, {
		target: `http://localhost:${ site.port }`,
		xfwd: true, // Pass along x-forwarded headers
		headers,
	} );
}

/**
 * Start HTTP proxy server on port 80
 */
async function startHttpProxy(): Promise< void > {
	if ( isHttpProxyRunning ) {
		console.log( '[Proxy] HTTP proxy already running' );
		return;
	}

	return new Promise< void >( ( resolve, reject ) => {
		httpProxyServer = http.createServer( ( req, res ) => handleProxyRequest( req, res, false ) );

		httpProxyServer
			.listen( 80, () => {
				console.log( '[Proxy] HTTP server started on port 80' );
				isHttpProxyRunning = true;
				resolve();
			} )
			.on( 'error', ( err ) => {
				console.error( '[Proxy] Error starting HTTP server:', err );
				reject( err );
			} );
	} );
}

/**
 * Start HTTPS proxy server on port 443
 */
async function startHttpsProxy(): Promise< void > {
	if ( isHttpsProxyRunning ) {
		console.log( '[Proxy] HTTPS proxy already running' );
		return;
	}

	return new Promise< void >( ( resolve, reject ) => {
		const defaultOptions: https.ServerOptions = {
			SNICallback: ( servername, cb ) => {
				try {
					const site = getSiteByHost( servername );
					if ( ! site || ! site.customDomain ) {
						console.error( `[Proxy] SNI: Invalid hostname: ${ servername }` );
						cb( new Error( `Invalid hostname: ${ servername }` ) );
						return;
					}

					if ( ! site.tlsKey || ! site.tlsCert ) {
						console.error(
							`[Proxy] Site ${ site.id } (${ site.customDomain }) does not have certificates`
						);
						cb( new Error( `No certificates available for ${ servername }` ) );
						return;
					}

					const ctx = createSecureContext( {
						key: site.tlsKey,
						cert: site.tlsCert,
						minVersion: 'TLSv1.2',
					} );

					cb( null, ctx );
				} catch ( error ) {
					console.error( `[Proxy] SNI callback error for ${ servername }:`, error );
					cb( error as Error );
				}
			},
		};

		httpsProxyServer = https.createServer( defaultOptions, ( req, res ) =>
			handleProxyRequest( req, res, true )
		);

		httpsProxyServer
			.listen( 443, () => {
				console.log( '[Proxy] HTTPS server started on port 443' );
				isHttpsProxyRunning = true;
				resolve();
			} )
			.on( 'error', ( err ) => {
				console.error( '[Proxy] Error starting HTTPS server:', err );
				reject( err );
			} );
	} );
}

/**
 * Stop the proxy servers gracefully
 */
export async function stopProxyServers(): Promise< void > {
	console.log( '[Proxy] Stopping proxy servers...' );

	const promises: Promise< void >[] = [];

	if ( httpProxyServer ) {
		promises.push(
			new Promise< void >( ( resolve ) => {
				httpProxyServer!.close( () => {
					httpProxyServer = null;
					isHttpProxyRunning = false;
					console.log( '[Proxy] HTTP server stopped' );
					resolve();
				} );
			} )
		);
	}

	if ( httpsProxyServer ) {
		promises.push(
			new Promise< void >( ( resolve ) => {
				httpsProxyServer!.close( () => {
					httpsProxyServer = null;
					isHttpsProxyRunning = false;
					console.log( '[Proxy] HTTPS server stopped' );
					resolve();
				} );
			} )
		);
	}

	await Promise.all( promises );
	console.log( '[Proxy] All servers stopped' );
}

/**
 * Setup file watcher for user data changes
 */
function setupFileWatcher() {
	try {
		const userDataPath = getUserDataFilePath();
		console.log( `[Proxy] Watching user data file: ${ userDataPath }` );

		// Check if file exists before trying to watch it
		const fs = require( 'fs' );
		if ( ! fs.existsSync( userDataPath ) ) {
			console.warn( `[Proxy] User data file does not exist yet: ${ userDataPath }` );
			console.warn( '[Proxy] File watcher not set up - will use cached data only' );
			return;
		}

		watch( userDataPath, ( eventType ) => {
			if ( eventType === 'change' ) {
				console.log( '[Proxy] User data file changed, invalidating cache' );
				invalidateCache();
			}
		} );
	} catch ( error ) {
		console.error( '[Proxy] Error setting up file watcher:', error );
		// Non-fatal error, continue without watching
	}
}

/**
 * Start the proxy servers
 * This is called by the `studio proxy start` command
 */
export async function startProxyServers(): Promise< void > {
	console.log( '[Proxy] Starting WordPress Studio Proxy Server...' );

	// Setup graceful shutdown
	const shutdown = async ( signal: string ) => {
		console.log( `[Proxy] Received ${ signal }, shutting down gracefully...` );
		await stopProxyServers();
		process.exit( 0 );
	};

	process.on( 'SIGTERM', () => shutdown( 'SIGTERM' ) );
	process.on( 'SIGINT', () => shutdown( 'SIGINT' ) );

	// Setup file watcher
	setupFileWatcher();

	try {
		// Start both HTTP and HTTPS proxies
		await startHttpProxy();
		await startHttpsProxy();

		console.log( '[Proxy] Proxy servers started successfully' );
		console.log( '[Proxy] Ready to handle custom domain requests' );

		// Keep the process running
		// PM2 will manage this process and keep it alive
		process.stdin.resume();
	} catch ( error ) {
		console.error( '[Proxy] Failed to start proxy servers:', error );
		throw error;
	}
}

/**
 * Check if the proxy is running
 */
export function isProxyRunning(): boolean {
	return isHttpProxyRunning || isHttpsProxyRunning;
}
