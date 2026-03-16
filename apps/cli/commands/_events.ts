/**
 * Hidden events command for Studio
 *
 * This command subscribes to CLI events and streams them back to Studio.
 * It's designed to be executed by Studio's main process and communicates via
 * stdout key-value pairs that Studio parses.
 */

import {
	SITE_EVENTS,
	SNAPSHOT_EVENTS,
	siteDetailsSchema,
	siteSocketEventSchema,
	snapshotSocketEventSchema,
	SiteEvent,
	SnapshotEvent,
} from '@studio/common/lib/cli-events';
import { sequential } from '@studio/common/lib/sequential';
import { SiteCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __ } from '@wordpress/i18n';
import { getSiteUrl, readCliConfig, SiteData } from 'cli/lib/cli-config';
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
		const cliConfig = await readCliConfig();
		const site = cliConfig.sites.find( ( s ) => s.id === siteId );
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
	const cliConfig = await readCliConfig();
	for ( const site of cliConfig.sites ) {
		await emitSiteEvent( SITE_EVENTS.UPDATED, site.id );
	}
}

async function emitAllSitesStopped(): Promise< void > {
	const cliConfig = await readCliConfig();
	for ( const site of cliConfig.sites ) {
		const payload: SiteEvent = {
			event: SITE_EVENTS.UPDATED,
			siteId: site.id,
			running: false,
			site: toSiteDetails( site ),
		};
		logger.reportKeyValuePair( 'site-event', JSON.stringify( payload ) );
	}
}

const emitSnapshotEvent = sequential(
	async ( event: SNAPSHOT_EVENTS, snapshotUrl: string ): Promise< void > => {
		const cliConfig = await readCliConfig();
		const snapshot = cliConfig.snapshots.find( ( s ) => s.url === snapshotUrl );
		const payload: SnapshotEvent = {
			event,
			snapshotUrl,
			snapshot: snapshot ?? undefined,
		};

		logger.reportKeyValuePair( 'snapshot-event', JSON.stringify( payload ) );
	}
);

export async function runCommand(): Promise< void > {
	const eventsSocketServer = new SocketServer( SITE_EVENTS_SOCKET_PATH, 2500 );
	eventsSocketServer.on( 'message', ( { message: packet } ) => {
		try {
			const snapshotParsed = snapshotSocketEventSchema.safeParse( packet );
			if ( snapshotParsed.success ) {
				void emitSnapshotEvent( snapshotParsed.data.event, snapshotParsed.data.data.snapshotUrl );
				return;
			}

			const parsedPacket = siteSocketEventSchema.parse( packet );
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
