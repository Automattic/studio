import { dialog } from 'electron';
import http from 'http';
import { createConnection } from 'node:net';
import { domainToASCII } from 'node:url';
import * as Sentry from '@sentry/electron/main';
import { __ } from '@wordpress/i18n';
import httpProxy from 'http-proxy';
import { getMainWindow } from 'src/main-window';
import { SiteServer } from 'src/site-server';
import { loadUserData } from 'src/storage/user-data';

let proxyServer: http.Server | null = null;
let isProxyRunning = false;

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
 * Starts the proxy server for sites with custom domains
 */
export async function startProxyServer(): Promise< boolean > {
	if ( isProxyRunning ) return true;

	try {
		// Create proxy with additional options to preserve host header
		const proxy = httpProxy.createProxyServer();

		proxy.on( 'error', ( err, req, res ) => {
			if ( res && res instanceof http.ServerResponse ) {
				res.writeHead( 500 );
				res.end( 'Proxy error: ' + err.message );
			}
		} );

		proxyServer = http.createServer( async ( req, res ) => {
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

			// Forward the request with the original host preserved
			proxy.web( req, res, {
				target: `http://localhost:${ site.port }`,
				xfwd: true, // Pass along x-forwarded headers
			} );
		} );

		// On Windows, we need to check if the port is in use before we can listen on it
		await new Promise< void >( ( resolve, reject ) => {
			const tester = createConnection( { port: 80 }, () => {
				// If we can connect, port is in use
				tester.end();
				const error = new Error( 'Port 80 is in use' ) as NodeJS.ErrnoException;
				error.code = 'EADDRINUSE';
				reject( error );
			} );

			tester.on( 'error', ( err: NodeJS.ErrnoException ) => {
				if ( err.code === 'ECONNREFUSED' ) {
					// Port is available
					resolve();
				} else {
					reject( err );
				}
			} );
		} );

		await new Promise< void >( ( resolve, reject ) => {
			proxyServer!
				.listen( 80, () => {
					console.log( `Proxy server started on port 80` );
					isProxyRunning = true;
					resolve();
				} )
				.on( 'error', ( err ) => {
					console.log( err );
					console.error( `Error starting proxy server on port 80:`, err );
					reject( err );
				} );
		} );

		return true;
	} catch ( error ) {
		if ( error instanceof Error && 'code' in error && error.code === 'EADDRINUSE' ) {
			const mainWindow = await getMainWindow();
			dialog.showMessageBox( mainWindow, {
				type: 'error',
				message: __( 'Custom domain set up failed' ),
				detail: __(
					'Studio needs to use port 80, but it’s already in use by another app. Close any local development apps and restart Studio.'
				),
				buttons: [ __( 'OK' ) ],
			} );
			return false;
		}

		Sentry.captureException( error );
		console.error( `Failed to start proxy server directly:`, error );
		return false;
	}
}

/**
 * Stop the proxy server
 */
export function stopProxyServer(): Promise< void > {
	return new Promise( ( resolve ) => {
		if ( ! proxyServer ) {
			isProxyRunning = false;
			resolve();
			return;
		}

		proxyServer.close( () => {
			proxyServer = null;
			isProxyRunning = false;
			console.log( 'Proxy server stopped' );
			resolve();
		} );
	} );
}

/**
 * Check if the proxy server is running
 */
export function isProxyServerRunning(): boolean {
	return isProxyRunning;
}
