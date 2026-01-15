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
import { sequential } from 'common/lib/sequential';
import { SITE_EVENTS, siteDetailsSchema, SiteEvent } from 'common/lib/site-events';
import { SiteCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import { getSiteUrl, readAppdata, SiteData } from 'cli/lib/appdata';
import {
	connect,
	disconnect,
	getEventsRelayProcessName,
	startEventsRelayProcess,
	stopEventsRelayProcess,
	subscribeProcessMessages,
	subscribePm2KillEvent,
} from 'cli/lib/pm2-manager';
import { isSiteRunning } from 'cli/lib/site-utils';
import { subscribeSiteEvents } from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';

const logger = new Logger< LoggerAction >();

function toSiteDetails( site: SiteData ) {
	return siteDetailsSchema.parse( {
		...site,
		url: getSiteUrl( site ),
	} );
}

const emitSiteEvent = sequential(
	async ( event: SITE_EVENTS, siteId: string, running?: boolean ): Promise< void > => {
		const appdata = await readAppdata();
		const site = appdata.sites.find( ( s ) => s.id === siteId );
		const payload: SiteEvent = {
			event,
			siteId,
			// Use provided running status, or query PM2 if not provided
			running: running ?? ( site ? await isSiteRunning( site ) : false ),
			site: site ? toSiteDetails( site ) : undefined,
		};

		logger.reportKeyValuePair( 'site-event', JSON.stringify( payload ) );
	}
);

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

export async function runCommand(): Promise< void > {
	logger.reportStart( LoggerAction.START_DAEMON, __( 'Connecting to process daemon…' ) );
	await connect();
	logger.reportSuccess( __( 'Connected to process daemon' ) );

	const relayScriptPath = path.join( __dirname, 'events-relay.js' );
	await startEventsRelayProcess( relayScriptPath );

	await emitAllSitesStatus();

	const relayProcessName = getEventsRelayProcessName();
	await subscribeProcessMessages( ( { processName, topic, data } ) => {
		if ( processName !== relayProcessName ) {
			return;
		}
		if (
			topic === SITE_EVENTS.CREATED ||
			topic === SITE_EVENTS.UPDATED ||
			topic === SITE_EVENTS.DELETED
		) {
			const eventData = data as { data?: { siteId?: string } };
			const siteId = eventData?.data?.siteId;
			if ( siteId ) {
				void emitSiteEvent( topic, siteId );
			}
		}
	} );

	await subscribeSiteEvents( ( { siteId, event, running } ) => {
		void emitSiteEvent( event, siteId, running );
	} );

	await subscribePm2KillEvent( () => {
		void emitAllSitesStopped();
	} );

	async function cleanup() {
		await stopEventsRelayProcess();
		await disconnect();
	}

	process.on( 'SIGINT', () => void cleanup() );
	process.on( 'SIGTERM', () => void cleanup() );
}

export async function commandHandler() {
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
}
