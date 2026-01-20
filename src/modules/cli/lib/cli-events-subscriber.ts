import { z } from 'zod';
import { sequential } from 'common/lib/sequential';
import { siteEventSchema, SiteEvent, SITE_EVENTS, SiteDetails } from 'common/lib/site-events';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { executeCliCommand } from 'src/modules/cli/lib/execute-command';
import { SiteServer } from 'src/site-server';

const cliSiteEventSchema = z.object( {
	action: z.literal( 'keyValuePair' ),
	key: z.literal( 'site-event' ),
	value: z
		.string()
		.transform( ( val ) => JSON.parse( val ) )
		.pipe( siteEventSchema ),
} );

let subscriber: ReturnType< typeof executeCliCommand > | null = null;

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

	// Only register new sites on CREATED events to prevent duplicates
	if ( eventType === SITE_EVENTS.CREATED ) {
		const existingServer = SiteServer.get( siteId ) ?? SiteServer.getByPath( site.path );
		if ( ! existingServer ) {
			SiteServer.register( siteDetailsToServerDetails( site, running ) );
		}
		// Don't send to renderer if site is being created by UI (createSite IPC will handle it)
		if ( existingServer?.hasOngoingOperation ) {
			return;
		}
		void sendIpcEventToRenderer( 'site-event', event );
		return;
	}

	// For UPDATED events, only update if the site already exists
	const server = SiteServer.get( siteId ) ?? SiteServer.getByPath( site.path );
	if ( ! server ) {
		return;
	}

	// Skip update if Studio has an ongoing operation
	if ( server.hasOngoingOperation ) {
		return;
	}

	server.details = siteDetailsToServerDetails( site, running, server.details );

	if ( server.server && site.url ) {
		server.server.url = site.url;
	}

	void sendIpcEventToRenderer( 'site-event', event );
} );

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
		const [ , childProcess ] = subscriber;
		childProcess.kill( 'SIGKILL' );
		subscriber = null;
	}
}
