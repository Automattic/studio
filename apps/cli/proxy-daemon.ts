/**
 * WordPress Studio Proxy Daemon
 *
 * This script is spawned by the process manager daemon when `studio site start` or
 * `studio create` commands run for sites that use a custom domain.
 *
 * It runs a proxy that listens on ports 80 (HTTP) and 443 (HTTPS) and routes requests to local
 * WordPress sites based on the Host header. It runs with elevated privileges to bind to ports
 * 80 and 443.
 *
 * The proxy:
 * - Reads site configurations from appdata-v1.json
 * - Generates SSL certificates for custom domains on-the-fly
 * - Routes HTTP/HTTPS requests to the appropriate local WordPress sites
 */

import { startProxyServers } from 'cli/lib/proxy-server';

async function main() {
	try {
		console.log( '[Proxy Daemon] Starting WordPress Studio Proxy Daemon…' );
		await startProxyServers();
	} catch ( error ) {
		console.error( '[Proxy Daemon] Failed to start:', error );
		process.exit( 1 );
	}
}

void main();
