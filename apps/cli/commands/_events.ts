/**
 * Hidden events command for Studio
 *
 * This command subscribes to CLI events and streams them back to Studio.
 * It's designed to be executed by Studio's main process and communicates via
 * stdout key-value pairs that Studio parses.
 */

import fs from 'fs';
import {
	AUTH_EVENTS,
	SITE_EVENTS,
	SNAPSHOT_EVENTS,
	siteDetailsSchema,
	socketEventSchema,
	SiteEvent,
	SnapshotEvent,
	AuthEvent,
} from '@studio/common/lib/cli-events';
import { isEmptyDir } from '@studio/common/lib/fs-utils';
import { sequential } from '@studio/common/lib/sequential';
import { SiteCommandLoggerAction as LoggerAction } from '@studio/common/logger-actions';
import { __ } from '@wordpress/i18n';
import { readCliConfig, SiteData } from 'cli/lib/cli-config/core';
import { getSiteUrl, removeSiteFromConfig } from 'cli/lib/cli-config/sites';
import {
	connectToDaemon,
	disconnectFromDaemon,
	SITE_EVENTS_SOCKET_PATH,
	getDaemonBus,
} from 'cli/lib/daemon-client';
import { getLiveSiteOperations } from 'cli/lib/site-operations';
import { isSiteRunning } from 'cli/lib/site-utils';
import { SocketServer } from 'cli/lib/socket';
import { SITE_PROCESS_PREFIX } from 'cli/lib/wordpress-server-manager';
import { Logger, LoggerError } from 'cli/logger';

const logger = new Logger< LoggerAction >();

function toSiteDetails( site: SiteData ) {
	// Overrides rather than augments `...site` — see the note in `site list`.
	const liveOperations = getLiveSiteOperations( site );

	return siteDetailsSchema.parse( {
		...site,
		operations: liveOperations.length > 0 ? liveOperations : undefined,
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
		if ( site.path && ( await isEmptyDir( site.path ).catch( () => true ) ) ) {
			await removeSiteFromConfig( site.id );
			await emitSiteEvent( SITE_EVENTS.DELETED, site.id );
			continue;
		}
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

function emitAuthEvent( event: AUTH_EVENTS, token?: AuthEvent[ 'token' ] ): void {
	const payload: AuthEvent = { event, token };
	logger.reportKeyValuePair( 'auth-event', JSON.stringify( payload ) );
}

const emitDeletedAllSnapshotsEvent = sequential(
	async ( event: SNAPSHOT_EVENTS.DELETED_ALL ): Promise< void > => {
		const payload: SnapshotEvent = { event };
		logger.reportKeyValuePair( 'snapshot-event', JSON.stringify( payload ) );
	}
);

const emitSingleSnapshotEvent = sequential(
	async (
		event: SNAPSHOT_EVENTS.CREATED | SNAPSHOT_EVENTS.UPDATED | SNAPSHOT_EVENTS.DELETED,
		snapshotUrl: string
	): Promise< void > => {
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
			const parsed = socketEventSchema.parse( packet );

			switch ( parsed.event ) {
				case AUTH_EVENTS.LOGIN:
				case AUTH_EVENTS.LOGOUT:
					void emitAuthEvent( parsed.event, parsed.data.token );
					break;

				case SNAPSHOT_EVENTS.CREATED:
				case SNAPSHOT_EVENTS.UPDATED:
				case SNAPSHOT_EVENTS.DELETED:
					void emitSingleSnapshotEvent( parsed.event, parsed.data.snapshotUrl );
					break;

				case SNAPSHOT_EVENTS.DELETED_ALL:
					void emitDeletedAllSnapshotsEvent( parsed.event );
					break;

				case SITE_EVENTS.CREATED:
				case SITE_EVENTS.UPDATED:
				case SITE_EVENTS.DELETED:
				case SITE_EVENTS.OPERATIONS_CHANGED:
					void emitSiteEvent( parsed.event, parsed.data.siteId );
					break;
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
	if ( process.platform !== 'win32' ) {
		try {
			fs.unlinkSync( SITE_EVENTS_SOCKET_PATH );
		} catch ( err ) {
			// ENOENT is fine — socket didn't exist. Any other error is unexpected but non-fatal.
		}
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

	const bus = await getDaemonBus();

	// Subscribe to IPC events from site processes. We treat a `result` message with no return value
	// (undefined) as a signal that a void-returning IPC command completed (e.g. `start-server`).
	// Commands that return a value (e.g. `stop-server`, `wp-cli-command`) must not be treated as
	// "server is running" based on their `result` messages.
	bus.on( 'process-message', ( message ) => {
		if ( ! message.process.name.startsWith( SITE_PROCESS_PREFIX ) ) {
			return;
		}

		if ( message.raw.topic === 'result' && message.raw.result === undefined ) {
			const siteId = message.process.name.replace( SITE_PROCESS_PREFIX, '' );
			void emitSiteEvent( SITE_EVENTS.UPDATED, siteId, true );
		}
	} );

	// Subscribe to process manager daemon events for site processes. All events are mapped to 'site-updated'.
	bus.on( 'process-event', ( event ) => {
		if ( ! event.process.name.startsWith( SITE_PROCESS_PREFIX ) ) {
			return;
		}

		if ( event.event !== 'online' ) {
			const siteId = event.process.name.replace( SITE_PROCESS_PREFIX, '' );
			void emitSiteEvent( SITE_EVENTS.UPDATED, siteId, false );
		}
	} );

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
