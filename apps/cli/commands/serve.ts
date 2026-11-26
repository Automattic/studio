import path from 'node:path';
import { readConfig } from '@studio/common/lib/config/store';
import { getStudioUserAgent } from '@studio/common/lib/user-agent';
import { getConfigDirectory } from '@studio/common/lib/well-known-paths';
import { __ } from '@wordpress/i18n';
import { capturePreview } from 'cli/lib/capture-preview';
import { getSiteUrl } from 'cli/lib/cli-config/sites';
import { createServeGate } from 'cli/lib/serve-gate';
import { ensureMachineTls, startLocalTls, syncHostsFile } from 'cli/lib/serve-local-tls';
import { getHostSiteLimits } from 'cli/lib/site-capacity';
import { getTracksOrigin, recordTracksEvent } from 'cli/lib/tracks';
import { LoggerError } from 'cli/logger';
import type { builder } from 'cli/commands/serve.command';
import type { CommandArgs } from 'cli/types';

const HOSTS_SYNC_MS = 3000;

/**
 * `studio ui` without the UI: the API, the agent and the sites, for a UI served from elsewhere,
 * such as Studio Cloud's. Configured through the environment the host sets:
 *
 * - `STUDIO_SERVE_SECRET`: the key session tokens are signed with. Required off loopback.
 * - `STUDIO_SERVE_ALLOWED_ORIGINS`: comma-separated origins of the UI.
 * - `STUDIO_CLOUD_DOMAIN`: when set, the API is at `https://<machine>.<domain>` and each site at
 *   `https://<site id>--<machine>.<domain>`, where the machine is `STUDIO_SERVE_MACHINE_ID` or
 *   Fly's `FLY_MACHINE_ID`. Sites are then private to the signed-in user, and the machine reaches
 *   them itself over HTTPS on 127.0.0.1 (see `serve-local-tls`).
 * - `STUDIO_SERVE_KEEPALIVE_URL`: requested every few minutes while an agent run is in progress,
 *   for a host that pauses idle servers. Typically this server's public `/api/health`.
 */
export async function commandHandler( argv: CommandArgs< typeof builder > ) {
	const host = argv.host as string;
	const port = argv.port as number;
	const secret = process.env.STUDIO_SERVE_SECRET;
	const isLoopback = host === 'localhost' || host === '::1' || host.startsWith( '127.' );
	if ( ! secret && ! isLoopback ) {
		throw new LoggerError( __( 'Set STUDIO_SERVE_SECRET to serve beyond this computer.' ) );
	}

	const machineId = process.env.STUDIO_SERVE_MACHINE_ID ?? process.env.FLY_MACHINE_ID;
	const domain = process.env.STUDIO_CLOUD_DOMAIN;
	const apiOrigin = domain && machineId ? `https://${ machineId }.${ domain }` : undefined;
	const siteHostSuffix = domain && machineId ? `--${ machineId }.${ domain }` : undefined;
	if ( domain && siteHostSuffix ) {
		// Every process started from here, the sites' and the agent's, inherits these.
		process.env.STUDIO_SITE_URL_TEMPLATE = `https://{id}${ siteHostSuffix }`;
		const tls = ensureMachineTls( path.join( getConfigDirectory(), 'serve-tls' ), domain );
		process.env.NODE_EXTRA_CA_CERTS = tls.caPath;
		process.env.SSL_CERT_FILE = tls.bundlePath;
		process.env.CURL_CA_BUNDLE = tls.bundlePath;
		// PHP, and WordPress's HTTP API through a Studio mu-plugin, which both pin their own bundle.
		process.env.PHP_INI_SCAN_DIR = `${ path.delimiter }${ tls.phpIniDir }`;
		process.env.STUDIO_CA_BUNDLE = tls.bundlePath;
		await startLocalTls( tls, port ).catch( ( error ) =>
			console.error( 'Sites can’t be reached from this machine over HTTPS:', error )
		);
		const syncHosts = async () => {
			const { sites } = await readConfig();
			syncHostsFile( [
				new URL( apiOrigin! ).hostname,
				...sites.map( ( site ) => new URL( getSiteUrl( site ) ).hostname ),
			] );
		};
		await syncHosts().catch( ( error ) => console.error( 'Couldn’t update /etc/hosts:', error ) );
		setInterval( () => void syncHosts().catch( () => undefined ), HOSTS_SYNC_MS ).unref();
	}
	process.env.STUDIO_TRACKS_ORIGIN = 'studio-cloud:v2';

	const allowedOrigins = ( process.env.STUDIO_SERVE_ALLOWED_ORIGINS ?? '' )
		.split( ',' )
		.map( ( origin ) => origin.trim() )
		.filter( Boolean );

	const [ { startLocalServer }, { getSessionsDirectory }, { STUDIO_SITES_ROOT } ] =
		await Promise.all( [
			import( '@studio/local' ),
			import( '@studio/common/lib/well-known-paths' ),
			import( 'cli/lib/site-paths' ),
		] );

	const server = await startLocalServer( {
		cliBinary: process.env.STUDIO_CLI_BIN ?? process.argv[ 1 ],
		sessionsRoot: getSessionsDirectory(),
		sitesRoot: STUDIO_SITES_ROOT,
		port,
		host,
		recordTracksEvent: ( event, props ) =>
			recordTracksEvent( event, { ...getTracksOrigin(), ...props } ),
		capturePreview,
		userAgent: getStudioUserAgent( __STUDIO_CLI_VERSION__ ),
		version: __STUDIO_CLI_VERSION__,
		allowedOrigins,
		siteLimits: getHostSiteLimits(),
		keepAliveUrl: process.env.STUDIO_SERVE_KEEPALIVE_URL || undefined,
		middleware: secret
			? [ createServeGate( { secret, machineId, apiOrigin, siteHostSuffix, allowedOrigins } ) ]
			: [],
	} );

	console.log( __( 'WordPress Studio is serving at:' ) );
	console.log( `  ${ apiOrigin ?? server.url }` );

	const shutdown = () => {
		void server.close().finally( () => process.exit( 0 ) );
	};
	process.on( 'SIGINT', shutdown );
	process.on( 'SIGTERM', shutdown );
}
