import http from 'http';
import https from 'https';
import { createSecureContext } from 'node:tls';
import { domainToASCII } from 'node:url';
import httpProxy from 'http-proxy';
import { generateSiteCertificate } from 'cli/lib/certificate-manager';
import { readCliConfig } from 'cli/lib/cli-config/core';

let httpProxyServer: http.Server | null = null;
let httpsProxyServer: https.Server | null = null;
let isHttpProxyRunning = false;
let isHttpsProxyRunning = false;

const proxy = httpProxy.createProxyServer();

// Setup error handling for the proxy
proxy.on( 'error', ( err, req, res ) => {
	console.error( '[Proxy Error]', err.message );
	if ( res && res instanceof http.ServerResponse ) {
		res.writeHead( 502, { 'Content-Type': 'text/plain' } );
		res.end( 'Proxy error: ' + err.message );
	}
} );

function logProxyBindError( err: NodeJS.ErrnoException, port: number ): void {
	console.error( `[Proxy] Error starting ${ port === 443 ? 'HTTPS' : 'HTTP' } server:`, err );

	if ( err.code === 'EACCES' && process.platform === 'linux' ) {
		console.error(
			`[Proxy] EACCES on port ${ port } — binding to privileged ports requires CAP_NET_BIND_SERVICE on Linux.\n` +
				`        Run: sudo setcap 'cap_net_bind_service=+ep' ${ process.execPath }`
		);
	}
}

/**
 * Gets the site details for a given domain
 */
async function getSiteByHost( domain: string ) {
	try {
		const cliConfig = await readCliConfig();
		const site = cliConfig.sites.find(
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
async function handleProxyRequest(
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

	const site = await getSiteByHost( host );
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
				logProxyBindError( err, 80 );
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
			SNICallback: async ( servername, cb ) => {
				try {
					const site = await getSiteByHost( servername );
					if ( ! site || ! site.customDomain || ! site.enableHttps ) {
						console.error( `[Proxy] SNI: Invalid hostname: ${ servername }` );
						cb( new Error( `Invalid hostname: ${ servername }` ) );
						return;
					}

					// Generate or load certificate from disk
					const { cert, key } = await generateSiteCertificate( site.customDomain );

					const ctx = createSecureContext( {
						key,
						cert,
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
				logProxyBindError( err, 443 );
				reject( err );
			} );
	} );
}

/**
 * Stop the proxy servers gracefully
 */
export async function stopProxyServers(): Promise< void > {
	console.log( '[Proxy] Stopping proxy servers…' );

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
 * Start the proxy servers
 * This is called by the `studio proxy start` command
 */
export async function startProxyServers(): Promise< void > {
	console.log( '[Proxy] Starting WordPress Studio Proxy Server…' );

	// Setup graceful shutdown
	const shutdown = async ( signal: string ) => {
		console.log( `[Proxy] Received ${ signal }, shutting down gracefully...` );
		await stopProxyServers();
		process.exit( 0 );
	};

	process.on( 'SIGTERM', () => shutdown( 'SIGTERM' ) );
	process.on( 'SIGINT', () => shutdown( 'SIGINT' ) );

	try {
		// Start both HTTP and HTTPS proxies
		await startHttpProxy();
		await startHttpsProxy();

		console.log( '[Proxy] Proxy servers started successfully' );
		console.log( '[Proxy] Ready to handle custom domain requests' );

		// Keep the process running
		// The process manager daemon will manage this process and keep it alive
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
