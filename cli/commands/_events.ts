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
	} ),
} );

export async function runCommand(): Promise< void > {
	const socket = axon.socket( 'pull' );
	const bindAbortController = new AbortController();

	async function cleanup() {
		if ( bindAbortController.signal.aborted ) {
			return;
		}

		bindAbortController.abort();

		await new Promise< void >( ( resolve ) => {
			// Only try to close if socket is actually bound
			if ( socket.type !== 'server' ) {
				return resolve();
			}

			socket.once( 'close', () => {
				clearTimeout( timeoutId );
				resolve();
			} );

			const timeoutId = setTimeout( () => {
				socket.destroy?.();
				resolve();
			}, 250 );

			socket.close();
		} );

		try {
			await disconnect();
		} catch ( err ) {
			// Do nothing
		}

		process.exit();
	}

	process.on( 'SIGINT', () => void cleanup() );
	process.on( 'SIGTERM', () => void cleanup() );

	try {
		await new Promise< void >( ( resolve, reject ) => {
			bindAbortController.signal.throwIfAborted();

			const timeout = setTimeout( () => {
				bindAbortController.signal.removeEventListener( 'abort', onAbort );
				reject( new Error( 'Socket bind timeout' ) );
			}, 2500 );

			function onAbort() {
				clearTimeout( timeout );
				reject( new Error( 'Bind aborted due to signal' ) );
			}
			bindAbortController.signal.addEventListener( 'abort', onAbort );

			socket.once( 'bind', () => {
				clearTimeout( timeout );
				bindAbortController.signal.removeEventListener( 'abort', onAbort );
				resolve();
			} );

			socket.bind( EVENTS_SOCKET_PATH, ( error: unknown ) => {
				if ( error ) {
					clearTimeout( timeout );
					bindAbortController.signal.removeEventListener( 'abort', onAbort );
					reject( error );
				}
			} );
		} );
	} catch ( error ) {
		await cleanup();
		return;
	}

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

	logger.reportStart( LoggerAction.START_DAEMON, __( 'Connecting to process daemon…' ) );
	await connect();
	logger.reportSuccess( __( 'Connected to process daemon' ) );

	await emitAllSitesStatus();

	await subscribeSiteEvents( ( { siteId, event, running } ) => {
		void emitSiteEvent( event, siteId, running );
	} );

	await subscribePm2KillEvent( () => {
		void emitAllSitesStopped();
	} );
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
