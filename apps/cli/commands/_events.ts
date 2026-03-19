/**
 * Hidden events command for Studio
 *
 * This command subscribes to CLI events and streams them back to Studio.
 * It's designed to be executed by Studio's main process and communicates via
 * stdout key-value pairs that Studio parses.
 */

import { sequential } from '@studio/common/lib/sequential';
import { SITE_EVENTS, siteDetailsSchema, SiteEvent } from '@studio/common/lib/site-events';
import { SiteCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __ } from '@wordpress/i18n';
import fs from 'fs';
import { z } from 'zod';
import { getSiteUrl, readAppdata, SiteData } from 'cli/lib/appdata';
import {
	connectToDaemon,
	disconnectFromDaemon,
	SITE_EVENTS_SOCKET_PATH,
	getDaemonBus,
} from 'cli/lib/daemon-client';
import { isSiteRunning } from 'cli/lib/site-utils';
import { SocketServer } from 'cli/lib/socket';
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
			// Use provided running status, or query process manager if not provided
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
	const eventsSocketServer = new SocketServer( SITE_EVENTS_SOCKET_PATH, 2500 );
	eventsSocketServer.on( 'message', ( { message: packet } ) => {
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

	async function cleanup() {
		await eventsSocketServer.close();

		try {
			await disconnectFromDaemon();
		} catch ( err ) {
			// Do nothing
		}

		process.exit();
	}

	process.on( 'SIGINT', () => void cleanup() );
	process.on( 'SIGTERM', () => void cleanup() );

	// Remove any stale socket from a previous Studio session. Studio is single-instance,
	// so any existing events.sock belongs to a dead session and must be replaced.
	try {
		fs.unlinkSync( SITE_EVENTS_SOCKET_PATH );
	} catch ( err ) {
		// ENOENT is fine — socket didn't exist. Any other error is unexpected but non-fatal.
	}

	try {
		await eventsSocketServer.listen();
	} catch ( error ) {
		console.error( 'Failed to bind to events socket', error );

		await cleanup();
		return;
	}

	logger.reportStart( LoggerAction.START_DAEMON, __( 'Connecting to process daemon…' ) );
	await connectToDaemon();
	logger.reportSuccess( __( 'Connected to process daemon' ) );

	await emitAllSitesStatus();

	await subscribeSiteEvents( ( { siteId, event, running } ) => {
		void emitSiteEvent( event, siteId, running );
	} );

	const bus = await getDaemonBus();

	bus.on( 'daemon-kill', () => {
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
