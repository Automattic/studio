/**
 * WordPress Studio Proxy Daemon
 *
 * This daemon is managed by PM2 and runs the HTTP/HTTPS proxy servers
 * for custom domain support. It runs with elevated privileges to bind
 * to ports 80 and 443.
 *
 * The proxy:
 * - Reads site configurations from appdata-v1.json
 * - Generates SSL certificates for custom domains on-the-fly
 * - Routes HTTP/HTTPS requests to the appropriate local WordPress sites
 */

import { startProxyServers } from 'cli/lib/proxy-server';

async function main() {
	try {
		console.log( '[Proxy Daemon] Starting WordPress Studio Proxy Daemon...' );
		await startProxyServers();
	} catch ( error ) {
		console.error( '[Proxy Daemon] Failed to start:', error );
		process.exit( 1 );
	}
}

void main();
