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
		const result = await startDomainProxy();
		if ( result ) {
			return true;
		}

		// If direct start fails and we're not skipping elevation, attempt with sudo/admin privileges
		return await startProxyWithElevation();
	} catch ( error ) {
		console.error( 'Failed to start proxy server:', error );
		return false;
	}
}

/**
 * Attempts to start the proxy server directly (without privilege elevation)
 * @param {number} port - The port to listen on (defaults to 80)
 */
async function startDomainProxy( port: number = 80 ): Promise< boolean > {
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
				.listen( port, () => {
					console.log( `Proxy server started on port ${ port }` );
					isProxyRunning = true;
					resolve();
				} )
				.on( 'error', ( err ) => {
					console.error( `Error starting proxy server on port ${ port }:`, err );
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
 * Attempts to start the proxy server with elevated privileges
 */
async function startProxyWithElevation(): Promise< boolean > {
	const currentPlatform = platform();

	try {
		console.log( 'Attempting to start proxy server with elevated privileges' );
		// First start the actual proxy on a non-privileged port (8880)
		const proxyStarted = await startDomainProxy( 8880 );
		if ( ! proxyStarted ) {
			console.error( 'Failed to start proxy server on port 8880' );
			return false;
		}

		// Then use netsh or iptables to forward from privileged port 80 to our proxy on 8880
		const elevatedProxyCommands: Record< string, string > = {
			win32:
				'netsh interface portproxy add v4tov4 listenport=80 listenaddress=127.0.0.1 connectport=8880 connectaddress=127.0.0.1',
			darwin:
				'echo "rdr pass inet proto tcp from any to any port 80 -> 127.0.0.1 port 8880" | sudo pfctl -ef -',
			linux: 'iptables -t nat -A PREROUTING -p tcp --dport 80 -j REDIRECT --to-port 8880',
		};
		const command = elevatedProxyCommands[ currentPlatform ];
		if ( ! command ) {
			console.error( 'Elevated privileges not supported on this platform' );
			return false;
		}

		try {
			// @ts-expect-error promisify doesn't seem typed properly.
			await sudoExec( command, { name: 'WordPress Studio Proxy' } );
			console.log( 'Successfully set up port forwarding from port 80 to 8880' );
			return true;
		} catch ( error ) {
			console.error( 'Failed to set up port forwarding:', error );
			// Even though port forwarding failed, we still have a working proxy on 8880
			return proxyStarted;
		}
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
