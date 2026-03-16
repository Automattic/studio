import {
	cliSiteEventSchema,
	cliSnapshotEventSchema,
	SiteEvent,
	SITE_EVENTS,
	SiteDetails,
} from '@studio/common/lib/cli-events';
import { sequential } from '@studio/common/lib/sequential';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { executeCliCommand } from 'src/modules/cli/lib/execute-command';
import { SiteServer } from 'src/site-server';

function siteDetailsToServerDetails(
	site: SiteDetails,
	running: boolean,
	existingDetails?: SiteServer[ 'details' ]
): SiteServer[ 'details' ] {
	return {
		...existingDetails,
		...site,
		running,
	};
}

const handleSiteEvent = sequential( async ( event: SiteEvent ): Promise< void > => {
	const { event: eventType, siteId, site, running } = event;

	if ( eventType === SITE_EVENTS.DELETED ) {
		SiteServer.unregister( siteId );
		void sendIpcEventToRenderer( 'site-event', event );
		return;
	}

	if ( ! site ) {
		return;
	}

	if ( eventType === SITE_EVENTS.CREATED ) {
		const existingServer = SiteServer.get( siteId ) ?? SiteServer.getByPath( site.path );
		if ( ! existingServer ) {
			SiteServer.register( siteDetailsToServerDetails( site, running ) );
		} else {
			existingServer.details = siteDetailsToServerDetails( site, running, existingServer.details );
		}
		void sendIpcEventToRenderer( 'site-event', event );
		return;
	}

	// For UPDATED events, update existing server details
	const server = SiteServer.get( siteId ) ?? SiteServer.getByPath( site.path );
	if ( ! server ) {
		console.warn( `Received UPDATED event for unknown site: ${ siteId }` );
		return;
	}

	server.details = siteDetailsToServerDetails( site, running, server.details );

	if ( server.server && site.url ) {
		server.server.url = site.url;
	}

	void sendIpcEventToRenderer( 'site-event', event );
} );

let subscriber: ReturnType< typeof executeCliCommand > | null = null;

export async function startCliEventsSubscriber(): Promise< void > {
	return new Promise( ( resolve, reject ) => {
		if ( subscriber ) {
			return resolve();
		}

		subscriber = executeCliCommand( [ '_events' ], {
			output: 'capture',
			logPrefix: 'events',
		} );
		const [ eventEmitter ] = subscriber;

		eventEmitter.on( 'started', () => {
			resolve();
		} );

		eventEmitter.on( 'data', ( { data } ) => {
			const snapshotParsed = cliSnapshotEventSchema.safeParse( data );
			if ( snapshotParsed.success ) {
				void sendIpcEventToRenderer( 'snapshot-changed', snapshotParsed.data.value );
				return;
			}

			const parsed = cliSiteEventSchema.safeParse( data );
			if ( ! parsed.success ) {
				return;
			}

			const siteEvent = parsed.data.value;
			void handleSiteEvent( siteEvent );
		} );

		eventEmitter.on( 'error', ( { error } ) => {
			reject( error );
			console.error( 'CLI events subscriber error:', error );
			subscriber = null;
		} );

		eventEmitter.on( 'failure', () => {
			console.warn( 'CLI events subscriber exited unexpectedly' );
			subscriber = null;
		} );
	} );
}

export function stopCliEventsSubscriber(): void {
	if ( subscriber ) {
		const [ eventEmitter, childProcess ] = subscriber;
		eventEmitter.removeAllListeners();
		childProcess.kill( 'SIGKILL' );
	}
}
