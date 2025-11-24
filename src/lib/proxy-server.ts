import http from 'http';
import https from 'https';
import { createSecureContext } from 'node:tls';
import { domainToASCII } from 'node:url';
import * as Sentry from '@sentry/electron/main';
import httpProxy from 'http-proxy';
import { portFinder } from 'common/lib/port-finder';
import { SiteServer } from 'src/site-server';
import { loadUserData } from 'src/storage/user-data';

let httpProxyServer: http.Server | null = null;
let httpsProxyServer: https.Server | null = null;
let isHttpProxyRunning = false;
let isHttpsProxyRunning = false;

const sequentialLocks = new Map< () => Promise< unknown >, Set< Promise< unknown > > >();

// Ensures that calls to the provided function are executed sequentially
function sequential< Args extends unknown[], Return >(
	fn: ( ...args: Args ) => Promise< Return >
) {
	return async ( ...args: Args ) => {
		const locks = sequentialLocks.get( fn ) ?? new Set();
		if ( ! sequentialLocks.has( fn ) ) {
			sequentialLocks.set( fn, locks );
		}

		const settledPromise = Promise.allSettled( [ ...locks ] );
		// Push the settled promise to the queue to ensure that subsequent calls wait their turn
		locks.add( settledPromise );
		await settledPromise;

		const fnPromise = fn( ...args );

		try {
			locks.add( fnPromise );
			return await fnPromise;
		} finally {
			locks.delete( settledPromise );
			locks.delete( fnPromise );
		}
	};
}

const proxy = httpProxy.createProxyServer();

// Setup error handling for the proxy
proxy.on( 'error', ( err, req, res ) => {
	if ( res && res instanceof http.ServerResponse ) {
		res.writeHead( 500 );
		res.end( 'Proxy error: ' + err.message );
	}
} );

/**
 * Gets the site details for a given domain by looking it up in user data and SiteServer
 */
async function getSiteByHost( domain: string ): Promise< SiteDetails | null > {
	try {
		const userData = await loadUserData();
		const site = userData.sites.find(
			( site ) => domainToASCII( site.customDomain ?? '' ) === domainToASCII( domain )
		);
		if ( site ) {
			const server = SiteServer.get( site.id );
			return server ? server.details : null;
		}

		return null;
	} catch ( error ) {
		console.error( 'Error looking up domain in user data:', error );
		return null;
	}
}

/**
 * Common handler for both HTTP and HTTPS requests
 */
async function handleProxyRequest(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	isHttps: boolean
) {
	const host = req.headers.host?.split( ':' )[ 0 ]; // Remove port if present

	if ( ! host ) {
		console.log( 'No host header found' );
		res.writeHead( 404 );
		res.end( 'No host header found' );
		return;
	}

	const site = await getSiteByHost( host );
	if ( ! site ) {
		console.log( `Domain not found: ${ host }` );
		res.writeHead( 404 );
		res.end( `Domain not found: ${ host }` );
		return;
	}

	if ( ! site.running ) {
		res.writeHead( 404 );
		res.end( `The Studio site is currently stopped: ${ site.name }` );
		return;
	}

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
 * On Windows, node doesn't throw an error if port is busy, so we use portFinder to check
 * if the port is available.
 */
export async function checkIfPortIsFree( port: number ): Promise< boolean > {
	const portAvailable = await portFinder.isPortAvailable( port );

	if ( ! portAvailable ) {
		throw new Error( 'PROXY_ERROR_PORT_IN_USE' );
	}

	return portAvailable;
}

/**
 * Attempts to start the proxy servers on ports 80 and 443
 * This requires admin/root privileges
 */
export const startProxyServer = sequential( async (): Promise< boolean > => {
	try {
		// Start HTTP server if not already running
		if ( ! isHttpProxyRunning ) {
			await checkIfPortIsFree( 80 );
			httpProxyServer = http.createServer( ( req, res ) => handleProxyRequest( req, res, false ) );
			await new Promise< void >( ( resolve, reject ) => {
				httpProxyServer!
					.listen( 80, () => {
						console.log( `HTTP Proxy server started on port 80` );
						isHttpProxyRunning = true;
						resolve();
					} )
					.on( 'error', ( err ) => {
						console.error( `Error starting HTTP proxy server on port 80:`, err );
						// Check for permission denied error
						if ( ( err as NodeJS.ErrnoException ).code === 'EACCES' ) {
							reject( new Error( 'PROXY_ERROR_PERMISSION_DENIED' ) );
						} else {
							reject( err );
						}
					} );
			} );
		}

		// Start HTTPS server if not already running
		if ( ! isHttpsProxyRunning ) {
			await checkIfPortIsFree( 443 );
			const defaultOptions: https.ServerOptions = {
				SNICallback: async ( servername, cb ) => {
					try {
						const site = await getSiteByHost( servername );
						if ( ! site || ! site.customDomain ) {
							console.error( `SNI: Invalid hostname: ${ servername }` );
							cb( new Error( `Invalid hostname: ${ servername }` ) );
							return;
						}

						if ( ! site.tlsKey || ! site.tlsCert ) {
							console.error(
								`Site ${ site.id } (${ site.customDomain }) does not have certificates generated at server start`
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
						console.error( `SNI callback error for ${ servername }:`, error );
						cb( error as Error );
					}
				},
			};

			httpsProxyServer = https.createServer( defaultOptions, ( req, res ) =>
				handleProxyRequest( req, res, true )
			);

			await new Promise< void >( ( resolve, reject ) => {
				httpsProxyServer!
					.listen( 443, () => {
						console.log( `HTTPS Proxy server started on port 443` );
						isHttpsProxyRunning = true;
						resolve();
					} )
					.on( 'error', ( err ) => {
						console.error( `Error starting HTTPS proxy server on port 443:`, err );
						// Check for permission denied error
						if ( ( err as NodeJS.ErrnoException ).code === 'EACCES' ) {
							reject( new Error( 'PROXY_ERROR_PERMISSION_DENIED' ) );
						} else {
							reject( err );
						}
					} );
			} );
		}

		return true;
	} catch ( error ) {
		if ( error instanceof Error && error.message === 'PROXY_ERROR_PORT_IN_USE' ) {
			throw error;
		}

		if ( error instanceof Error && error.message === 'PROXY_ERROR_PERMISSION_DENIED' ) {
			throw error;
		}

		Sentry.captureException( error );
		console.error( 'Failed to start proxy servers:', error );

		throw new Error( 'PROXY_ERROR_START_FAILED' );
	}
} );

/**
 * Stop the proxy servers
 */
export async function stopProxyServer() {
	const promises: Promise< void >[] = [];

	// Stop HTTP proxy if running
	if ( httpProxyServer ) {
		promises.push(
			new Promise< void >( ( resolve ) => {
				httpProxyServer!.close( () => {
					httpProxyServer = null;
					isHttpProxyRunning = false;
					console.log( 'HTTP Proxy server stopped' );
					resolve();
				} );
			} )
		);
	} else {
		isHttpProxyRunning = false;
	}

	// Stop HTTPS proxy if running
	if ( httpsProxyServer ) {
		promises.push(
			new Promise< void >( ( resolve ) => {
				httpsProxyServer!.close( () => {
					httpsProxyServer = null;
					isHttpsProxyRunning = false;
					console.log( 'HTTPS Proxy server stopped' );
					resolve();
				} );
			} )
		);
	} else {
		isHttpsProxyRunning = false;
	}

	await Promise.all( promises );
}

/**
 * Check if the proxy servers are running
 */
export function isProxyServerRunning(): boolean {
	return isHttpProxyRunning || isHttpsProxyRunning;
}
