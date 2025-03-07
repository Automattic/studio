import http from 'http';
import httpProxy from 'http-proxy';
import { loadUserData } from 'src/storage/user-data';

let proxyServer: http.Server | null = null;
let isProxyRunning = false;

/**
 * Gets the port number for a given domain by looking it up in user data
 */
async function getPortForDomain( domain: string ): Promise< number | null > {
	try {
		const userData = await loadUserData();
		// Find the site with the matching custom domain
		const site = userData.sites.find(
			( site ) => site.useCustomDomain && site.customDomain === domain
		);
		return site ? site.port : null;
	} catch ( error ) {
		console.error( 'Error looking up domain in user data:', error );
		return null;
	}
}

/**
 * Attempts to start the proxy server on port 80
 * This requires admin/root privileges
 */
export async function startProxyServer(): Promise< boolean > {
	if ( isProxyRunning ) return true;

	try {
		return await startDomainProxy();
	} catch ( error ) {
		console.error( 'Failed to start proxy server:', error );
		return false;
	}
}

/**
 * Starts the proxy server for sites with custom domains
 */
async function startDomainProxy(): Promise< boolean > {
	try {
		// Create proxy with additional options to preserve host header
		const proxy = httpProxy.createProxyServer();

		proxy.on( 'error', ( err, req, res ) => {
			if ( res && 'writeHead' in res ) {
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

			const port = await getPortForDomain( host );
			if ( ! port ) {
				console.log( `Domain not found: ${ host }` );
				res.writeHead( 404 );
				res.end( `Domain not found: ${ host }` );
				return;
			}

			// Forward the request with the original host preserved
			proxy.web( req, res, {
				target: `http://localhost:${ port }`,
				xfwd: true, // Pass along x-forwarded headers
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
					console.error( `Error starting proxy server on port 80:`, err );
					reject( err );
				} );
		} );

		return true;
	} catch ( error ) {
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
