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
	running: boolean
): SiteServer[ 'details' ] {
	return {
		...site,
		running,
	};
}

const handleSiteEvent = sequential( async ( event: SiteEvent ): Promise< void > => {
	const { event: eventType, siteId, site, running } = event;

	if ( eventType === SITE_EVENTS.DELETED ) {
		SiteServer.unregister( siteId );
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

	server.details = siteDetailsToServerDetails( site, running );

	if ( server.server && site.url ) {
		server.server.url = site.url;
	}
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
		const [ eventEmitter, childProcess ] = subscriber;

		eventEmitter.on( 'started', () => {
			const pid = childProcess.pid;
			console.log( `events subscriber with pid ${ pid } started` );
			resolve();
		} );

		eventEmitter.on( 'data', ( { data } ) => {
			const parsed = cliSiteEventSchema.safeParse( data );
			if ( ! parsed.success ) {
				return;
			}

			const siteEvent = parsed.data.value;
			void handleSiteEvent( siteEvent );
			void sendIpcEventToRenderer( 'site-event', siteEvent );
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
		const pid = childProcess.pid;
		const result = childProcess.kill();
		console.log( `events subscriber process with pid ${ pid } killed with result ${ result }` );
		subscriber = null;
	}
}
