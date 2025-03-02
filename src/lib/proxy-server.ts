import http from 'http';
import { platform } from 'os';
import { promisify } from 'util';
import httpProxy from 'http-proxy';
import sudo from 'sudo-prompt';
import { loadUserData } from 'src/storage/user-data';

const sudoExec = promisify( sudo.exec );

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
		// First, try starting on a privileged port directly (might work if app has permissions)
		const result = await startProxyDirectly();
		if ( result ) {
			return true;
		}

		// If direct start fails, attempt with sudo/admin privileges
		return await startProxyWithElevation();
	} catch ( error ) {
		console.error( 'Failed to start proxy server:', error );
		return false;
	}
}

/**
 * Attempts to start the proxy server directly (without privilege elevation)
 */
async function startProxyDirectly(): Promise< boolean > {
	try {
		// Create proxy with additional options to preserve host header
		const proxy = httpProxy.createProxyServer();

		proxy.on( 'error', ( err, req, res ) => {
			console.error( 'Proxy error:', err );
			if ( res && 'writeHead' in res ) {
				res.writeHead( 500 );
				res.end( 'Proxy error: ' + err.message );
			}
		} );

		proxyServer = http.createServer( async ( req, res ) => {
			const host = req.headers.host?.split( ':' )[ 0 ]; // Remove port if present

			// Log incoming request information for debugging
			console.log( `Received request with host header: ${ host }` );

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

			console.log( `Proxying request for ${ host } to port ${ port }` );

			// Forward the request with the original host preserved
			proxy.web( req, res, {
				target: `http://localhost:${ port }`,
				xfwd: true, // Pass along x-forwarded headers
			} );
		} );

		await new Promise< void >( ( resolve, reject ) => {
			proxyServer!
				.listen( 80, () => {
					console.log( 'Proxy server started on port 80' );
					isProxyRunning = true;
					resolve();
				} )
				.on( 'error', ( err ) => {
					console.error( 'Error starting proxy server on port 80:', err );
					reject( err );
				} );
		} );

		return true;
	} catch ( error ) {
		console.error( 'Failed to start proxy server directly:', error );
		return false;
	}
}

/**
 * Attempts to start the proxy server with elevated privileges
 */
async function startProxyWithElevation(): Promise< boolean > {
	const currentPlatform = platform();

	// We need to create a separate script that can be run with elevated privileges
	try {
		console.log( 'Attempting to start proxy server with elevated privileges' );

		// For now, this is a simplified implementation
		// In a full solution, we would need a more sophisticated approach for each platform
		const command =
			currentPlatform === 'win32'
				? 'netsh interface portproxy add v4tov4 listenport=80 listenaddress=127.0.0.1 connectport=8880 connectaddress=127.0.0.1'
				: 'sudo -p "Enter password to start proxy server: " node -e "require(\'http\').createServer((req, res) => { res.end(\'hello\') }).listen(80)"';

		// @ts-expect-error promisify doesn't seem typed properly.
		await sudoExec( command, { name: 'WordPress Studio Proxy' } );

		// If we get here, assume the proxy was started successfully
		isProxyRunning = true;
		return true;
	} catch ( error ) {
		console.error( 'Failed to start proxy with elevated privileges:', error );
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
