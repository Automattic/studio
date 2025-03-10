import { dialog } from 'electron';
import http from 'http';
import https from 'https';
import { createConnection } from 'node:net';
import { SecureContext } from 'node:tls';
import { domainToASCII } from 'node:url';
import * as Sentry from '@sentry/electron/main';
import { __ } from '@wordpress/i18n';
import httpProxy from 'http-proxy';
import { isErrnoException } from 'src/lib/is-errno-exception';
import { getMainWindow } from 'src/main-window';
import { SiteServer } from 'src/site-server';
import { loadUserData } from 'src/storage/user-data';

let httpProxyServer: http.Server | null = null;
let httpsProxyServer: https.Server | null = null;
let isHttpProxyRunning = false;
let isHttpsProxyRunning = false;

// Create a shared proxy handler
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
	isHttps = false
) {
	const host = req.headers.host?.split( ':' )[ 0 ]; // Remove port if present

	// Look up the port directly from user data
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

	// For debugging
	console.log(
		`Handling request for ${ host }, HTTPS: ${ isHttps }, site.enableSSL: ${ site.enableSSL }`
	);

	// If we're on HTTP and site has HTTPS enabled, redirect to HTTPS
	if ( ! isHttps && site.enableSSL ) {
		console.log( `Redirecting ${ host } to HTTPS` );
		res.writeHead( 301, {
			Location: `https://${ host }${ req.url }`,
		} );
		res.end();
		return;
	}

	// Forward the request with the original host preserved
	const headers: Record< string, string > = {};

	// If this is an HTTPS request, add the X-Forwarded-Proto header
	if ( isHttps ) {
		headers[ 'X-Forwarded-Proto' ] = 'https';
	}

	console.log( `Proxying request to port ${ site.port } for ${ host }` );

	proxy.web( req, res, {
		target: `http://localhost:${ site.port }`,
		xfwd: true, // Pass along x-forwarded headers
		headers,
	} );
}

export async function checkPortInWindows( port: number ): Promise< boolean > {
	// On Windows, node doesn't throw an error if port is busy, so we use the net module to explicitly check
	// if it's possible to establish a TCP connection to that port (meaning it's busy)
	if ( process.platform === 'win32' ) {
		await new Promise< void >( ( resolve, reject ) => {
			const tester = createConnection( { port }, () => {
				// If we can connect, port is in use
				tester.end();
				reject( new Error( 'EADDRINUSE' ) );
			} );

			tester.setTimeout( 1000, () => {
				tester.destroy();
				reject( new Error( 'EADDRINUSE' ) );
			} );

			tester.on( 'error', ( err ) => {
				if ( isErrnoException( err ) && err.code === 'ECONNREFUSED' ) {
					// Port is available
					resolve();
				} else {
					reject( err );
				}
			} );
		} );
	}

	return true;
}

/**
 * Attempts to start the proxy servers on ports 80 and 443
 * This requires admin/root privileges
 */
export async function startProxyServer(): Promise< boolean > {
	try {
		// Start HTTP server if not already running
		if ( ! isHttpProxyRunning ) {
			await checkPortInWindows( 80 );
			httpProxyServer = http.createServer( ( req, res ) => handleProxyRequest( req, res, false ) );

			// Start HTTP server
			await new Promise< void >( ( resolve, reject ) => {
				httpProxyServer!
					.listen( 80, () => {
						console.log( `HTTP Proxy server started on port 80` );
						isHttpProxyRunning = true;
						resolve();
					} )
					.on( 'error', ( err ) => {
						console.error( `Error starting HTTP proxy server on port 80:`, err );
						reject( err );
					} );
			} );
		}

		// Start HTTPS server if not already running
		if ( ! isHttpsProxyRunning ) {
			await checkPortInWindows( 443 );
			// Create a default HTTPS server with SNI callbacks for dynamic certificates
			const defaultOptions = {
				SNICallback: async (
					servername: string,
					cb: ( err: Error | null, ctx?: SecureContext ) => void
				) => {
					try {
						console.log( `SNI callback for domain: ${ servername }` );

						// Look up the site by host
						const site = await getSiteByHost( servername );
						if ( ! site || ! site.customDomain ) {
							console.error( `SNI: Invalid hostname: ${ servername }` );
							cb( new Error( `Invalid hostname: ${ servername }` ) );
							return;
						}

						console.log( `SNI: Found site: ${ site.name }, enableSSL: ${ site.enableSSL }` );

						// Use the certificates that were generated at server start time
						// If they don't exist, this will fail
						if ( ! site.tlsKey || ! site.tlsCert ) {
							console.error(
								`Site ${ site.id } (${ site.customDomain }) does not have certificates generated at server start`
							);
							cb( new Error( `No certificates available for ${ servername }` ) );
							return;
						}

						// Create a secure context
						const ctx = require( 'tls' ).createSecureContext( {
							key: site.tlsKey,
							cert: site.tlsCert,
							version: 'TLSv1.2',
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

			// Start HTTPS server
			await new Promise< void >( ( resolve, reject ) => {
				httpsProxyServer!
					.listen( 443, () => {
						console.log( `HTTPS Proxy server started on port 443` );
						isHttpsProxyRunning = true;
						resolve();
					} )
					.on( 'error', ( err ) => {
						console.error( `Error starting HTTPS proxy server on port 443:`, err );
						reject( err );
					} );
			} );
		}

		return true;
	} catch ( error ) {
		if (
			( isErrnoException( error ) && error.code === 'EADDRINUSE' ) ||
			( error instanceof Error && error.message === 'EADDRINUSE' )
		) {
			const mainWindow = await getMainWindow();
			dialog.showMessageBox( mainWindow, {
				type: 'error',
				message: __( 'Custom domain set up failed' ),
				detail: __(
					'Studio needs to use port 80 and 443, but they are already in use by another app. Close any local development apps and restart Studio.'
				),
				buttons: [ __( 'OK' ) ],
			} );
			return false;
		}

		Sentry.captureException( error );
		console.error( 'Failed to start proxy servers:', error );
		return false;
	}
}

/**
 * Stop the proxy servers
 */
export function stopProxyServer(): Promise< void > {
	return new Promise( ( resolve ) => {
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

		// Resolve when all servers are stopped
		Promise.all( promises ).then( () => resolve() );
	} );
}

/**
 * Check if the proxy servers are running
 */
export function isProxyServerRunning(): boolean {
	return isHttpProxyRunning || isHttpsProxyRunning;
}
