/**
 * Hidden events command for Studio
 *
 * This command subscribes to CLI events and streams them back to Studio.
 * It's designed to be executed by Studio's main process and communicates via
 * stdout key-value pairs that Studio parses.
 *
 * Currently supported events:
 * - Site lifecycle: site-created, site-updated, site-deleted (via relay process)
 * - Site status: online, exit, stop (WordPress server state changes)
 *
 * Architecture:
 * 1. This command starts a PM2 relay process to receive events from CLI commands
 * 2. CLI commands (create/set/delete) send events to the relay via PM2 IPC
 * 3. The relay re-emits events on PM2 bus
 * 4. This command subscribes to PM2 bus and outputs events to stdout
 * 5. Studio reads stdout and updates UI
 *
 * Future event types can be added here (auth, sync, etc.)
 */
import path from 'path';
import { __ } from '@wordpress/i18n';
import { SiteCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import { getSiteUrl, readAppdata, SiteData } from 'cli/lib/appdata';
import {
	connect,
	getEventsRelayProcessName,
	startEventsRelayProcess,
	stopEventsRelayProcess,
	subscribeProcessMessages,
} from 'cli/lib/pm2-manager';
import { isServerRunning, subscribeSiteEvents } from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< LoggerAction >();

interface SiteStatusPayload {
	siteId: string;
	status: 'running' | 'stopped';
	url: string;
}

async function getSiteStatus( site: SiteData ): Promise< SiteStatusPayload > {
	const processInfo = await isServerRunning( site.id );
	const isReady =
		processInfo && site.latestCliPid !== undefined && processInfo.pid === site.latestCliPid;

	return {
		siteId: site.id,
		status: isReady ? 'running' : 'stopped',
		url: getSiteUrl( site ),
	};
}

function sendSiteStatus( payload: SiteStatusPayload ): void {
	logger.reportKeyValuePair( 'site-status', JSON.stringify( payload ) );
}

async function emitAllSitesStatus(): Promise< void > {
	const appdata = await readAppdata();
	for ( const site of appdata.sites ) {
		const payload = await getSiteStatus( site );
		sendSiteStatus( payload );
	}
}

async function emitSiteStatus( siteId: string ): Promise< void > {
	const appdata = await readAppdata();
	const site = appdata.sites.find( ( s ) => s.id === siteId );
	if ( site ) {
		const payload = await getSiteStatus( site );
		sendSiteStatus( payload );
	}
}

async function handleSiteEvent( event: string, siteId: string ): Promise< void > {
	if ( event === 'site-created' || event === 'site-updated' || event === 'site-deleted' ) {
		await emitAllSitesStatus();
	} else {
		await emitSiteStatus( siteId );
	}
}

const LIFECYCLE_EVENTS = [ 'site-created', 'site-updated', 'site-deleted' ];

export async function runCommand(): Promise< void > {
	logger.reportStart( LoggerAction.START_DAEMON, __( 'Connecting to process daemon…' ) );
	await connect();
	logger.reportSuccess( __( 'Connected to process daemon' ) );

	const relayScriptPath = path.join( __dirname, 'events-relay.js' );
	await startEventsRelayProcess( relayScriptPath );

	const cleanup = () => {
		void stopEventsRelayProcess();
	};
	process.on( 'exit', cleanup );
	process.on( 'SIGINT', cleanup );
	process.on( 'SIGTERM', cleanup );

	await emitAllSitesStatus();

	const relayProcessName = getEventsRelayProcessName();
	await subscribeProcessMessages( async ( { processName, topic, data } ) => {
		if ( processName !== relayProcessName ) {
			return;
		}
		if ( LIFECYCLE_EVENTS.includes( topic ) ) {
			const eventData = data as { data?: { siteId?: string } };
			const siteId = eventData?.data?.siteId;
			if ( siteId ) {
				await handleSiteEvent( topic, siteId );
			}
		}
	} );

	await subscribeSiteEvents(
		async ( { siteId, event } ) => {
			await handleSiteEvent( event, siteId );
		},
		{ debounceMs: 100 }
	);
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: '_events',
		describe: false, // Hidden command
		handler: async () => {
			try {
				await runCommand();
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					const loggerError = new LoggerError( __( 'Events watcher failed' ), error );
					logger.reportError( loggerError );
				}
			}
		},
	} );
};
