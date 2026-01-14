/**
 * Hidden events command for Studio
 *
 * This command subscribes to CLI events and streams them back to Studio.
 * It's designed to be executed by Studio's main process and communicates via
 * stdout key-value pairs that Studio parses.
 *
 */
import path from 'path';
import { __ } from '@wordpress/i18n';
import { SITE_EVENTS, siteDetailsSchema, SiteEvent } from 'common/lib/site-events';
import { SiteCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import { getSiteUrl, readAppdata, SiteData } from 'cli/lib/appdata';
import {
	connect,
	disconnect,
	getEventsRelayProcessName,
	startEventsRelayProcess,
	subscribeProcessMessages,
	subscribePm2KillEvent,
} from 'cli/lib/pm2-manager';
import { isSiteRunning } from 'cli/lib/site-utils';
import { subscribeSiteEvents } from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< LoggerAction >();

function toSiteDetails( site: SiteData ) {
	return siteDetailsSchema.parse( {
		...site,
		url: getSiteUrl( site ),
	} );
}

async function emitSiteEvent( event: string, siteId: string ): Promise< void > {
	const appdata = await readAppdata();
	const site = appdata.sites.find( ( s ) => s.id === siteId );
	const payload: SiteEvent = {
		event,
		siteId,
		running: site ? await isSiteRunning( site ) : false,
		site: site ? toSiteDetails( site ) : undefined,
	};

	logger.reportKeyValuePair( 'site-event', JSON.stringify( payload ) );
}

async function emitAllSitesStatus(): Promise< void > {
	const appdata = await readAppdata();
	for ( const site of appdata.sites ) {
		await emitSiteEvent( SITE_EVENTS.UPDATED, site.id );
	}
}

async function emitAllSitesStopped(): Promise< void > {
	const appdata = await readAppdata();
	for ( const site of appdata.sites ) {
		const payload: SiteEvent = {
			event: SITE_EVENTS.UPDATED,
			siteId: site.id,
			running: false,
			site: toSiteDetails( site ),
		};
		logger.reportKeyValuePair( 'site-event', JSON.stringify( payload ) );
	}
}

const LIFECYCLE_EVENTS: string[] = Object.values( SITE_EVENTS );

export async function runCommand(): Promise< void > {
	logger.reportStart( LoggerAction.START_DAEMON, __( 'Connecting to process daemon…' ) );
	await connect();
	logger.reportSuccess( __( 'Connected to process daemon' ) );

	const relayScriptPath = path.join( __dirname, 'events-relay.js' );
	await startEventsRelayProcess( relayScriptPath );

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
				await emitSiteEvent( topic, siteId );
			}
		}
	} );

	await subscribeSiteEvents(
		async ( { siteId, event } ) => {
			await emitSiteEvent( event, siteId );
		},
		{ debounceMs: 100 }
	);

	await subscribePm2KillEvent( () => {
		void emitAllSitesStopped();
	} );

	// Match the old site list --watch pattern: just disconnect on signal
	// and let the process exit naturally when all handles are released
	process.on( 'SIGINT', disconnect );
	process.on( 'SIGTERM', disconnect );
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
