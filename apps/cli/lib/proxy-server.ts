import http from 'http';
import https from 'https';
import { createSecureContext } from 'node:tls';
import { domainToASCII } from 'node:url';
import {
	PROXY_CONTROL_HEADER,
	PROXY_DISABLE_HTTPS_PATH,
	PROXY_ENABLE_HTTPS_PATH,
} from '@studio/common/constants';
import httpProxy from 'http-proxy';
import { generateSiteCertificate } from 'cli/lib/certificate-manager';
import { readCliConfig } from 'cli/lib/cli-config/core';

let httpProxyServer: http.Server | null = null;
let httpsProxyServer: https.Server | null = null;
let isHttpProxyRunning = false;
let isHttpsProxyRunning = false;

const proxy = httpProxy.createProxyServer();

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

function handleHealthCheck( res: http.ServerResponse ) {
	respondWithProxyStatus( res );
}

const LOOPBACK_ADDRESSES = [ '127.0.0.1', '::1', '::ffff:127.0.0.1' ];

/**
 * Lets the CLI bind or release port 443 as sites that use HTTPS start and stop. The custom header
 * keeps web pages from reaching it: a cross-origin request carrying it needs a preflight, which
 * the proxy never grants.
 */
async function handleHttpsControl(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	enable: boolean
) {
	const isFromCli =
		req.method === 'POST' &&
		LOOPBACK_ADDRESSES.includes( req.socket.remoteAddress ?? '' ) &&
		req.headers[ PROXY_CONTROL_HEADER ] !== undefined;
	if ( ! isFromCli ) {
		res.writeHead( 403, { 'Content-Type': 'text/plain' } );
		res.end( 'Forbidden' );
		return;
	}

	try {
		await setHttpsProxyEnabled( enable );
		respondWithProxyStatus( res );
	} catch ( error ) {
		res.writeHead( 500, { 'Content-Type': 'text/plain' } );
		res.end( String( error ) );
	}
}

function respondWithProxyStatus( res: http.ServerResponse ) {
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
	if ( req.url === '/__studio_health' ) {
		return handleHealthCheck( res );
	}

	if ( ! isHttps && req.url === PROXY_ENABLE_HTTPS_PATH ) {
		return handleHttpsControl( req, res, true );
	}

	if ( ! isHttps && req.url === PROXY_DISABLE_HTTPS_PATH ) {
		return handleHttpsControl( req, res, false );
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
				httpsProxyServer = null;
				reject( err );
			} );
	} );
}

async function stopHttpsProxy(): Promise< void > {
	const server = httpsProxyServer;
	if ( ! server ) {
		return;
	}

	httpsProxyServer = null;
	isHttpsProxyRunning = false;
	await new Promise< void >( ( resolve ) => {
		server.close( () => {
			console.log( '[Proxy] HTTPS server stopped' );
			resolve();
		} );
		server.closeAllConnections();
	} );
}

let httpsProxyChange: Promise< void > = Promise.resolve();

/**
 * Binds port 443 while a running site uses HTTPS and releases it otherwise. Changes run one at a
 * time, so concurrent site starts and stops leave the port in the last requested state.
 */
function setHttpsProxyEnabled( enable: boolean ): Promise< void > {
	const change = httpsProxyChange.then( () => ( enable ? startHttpsProxy() : stopHttpsProxy() ) );
	httpsProxyChange = change.catch( () => undefined );
	return change;
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

	promises.push( setHttpsProxyEnabled( false ) );

	await Promise.all( promises );
	console.log( '[Proxy] All servers stopped' );
}

/**
 * Start the proxy servers
 * This is called by the `studio proxy start` command
 */
export async function startProxyServers(): Promise< void > {
	console.log( '[Proxy] Starting WordPress Studio Proxy Server…' );

	const shutdown = async ( signal: string ) => {
		console.log( `[Proxy] Received ${ signal }, shutting down gracefully...` );
		await stopProxyServers();
		process.exit( 0 );
	};

	process.on( 'SIGTERM', () => shutdown( 'SIGTERM' ) );
	process.on( 'SIGINT', () => shutdown( 'SIGINT' ) );

	try {
		// Port 443 is bound later, when the CLI starts a site that uses HTTPS
		await startHttpProxy();

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
