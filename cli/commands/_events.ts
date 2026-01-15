/**
 * Hidden events command for Studio
 *
 * This command subscribes to CLI events and streams them back to Studio.
 * It's designed to be executed by Studio's main process and communicates via
 * stdout key-value pairs that Studio parses.
 *
 */
import { __ } from '@wordpress/i18n';
import { sequential } from 'common/lib/sequential';
import { SITE_EVENTS, siteDetailsSchema, SiteEvent } from 'common/lib/site-events';
import { SiteCommandLoggerAction as LoggerAction } from 'common/logger-actions';
import axon from 'pm2-axon';
import { z } from 'zod';
import { getSiteUrl, readAppdata, SiteData } from 'cli/lib/appdata';
import {
	connect,
	disconnect,
	subscribePm2KillEvent,
	EVENTS_SOCKET_PATH,
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

const siteEventSchema = z.object( {
	event: z.string(),
	data: z.object( {
		siteId: z.string(),
		url: z.string().optional(),
	} ),
} );

export async function runCommand(): Promise< void > {
	logger.reportStart( LoggerAction.START_DAEMON, __( 'Connecting to process daemon…' ) );
	await connect();
	logger.reportSuccess( __( 'Connected to process daemon' ) );

	await emitAllSitesStatus();

	const socket = axon.socket( 'pull' );
	socket.bind( EVENTS_SOCKET_PATH );

	socket.on( 'message', ( packet: unknown ) => {
		try {
			const parsedPacket = siteEventSchema.parse( packet );
			if (
				parsedPacket.event === SITE_EVENTS.CREATED ||
				parsedPacket.event === SITE_EVENTS.UPDATED ||
				parsedPacket.event === SITE_EVENTS.DELETED
			) {
				void emitSiteEvent( parsedPacket.event, parsedPacket.data.siteId );
			}
		} catch ( error ) {
			// Do nothing
		}
	} );

	await subscribeSiteEvents( ( { siteId, event, running } ) => {
		void emitSiteEvent( event, siteId, running );
	} );

	await subscribePm2KillEvent( () => {
		void emitAllSitesStopped();
	} );

	async function cleanup() {
		await new Promise< void >( ( resolve ) => {
			socket.once( 'close', () => {
				clearTimeout( timeoutId );
				resolve();
			} );

			const timeoutId = setTimeout( () => {
				socket.destroy?.();
				resolve();
			}, 200 );

			socket.close();
		} );
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
