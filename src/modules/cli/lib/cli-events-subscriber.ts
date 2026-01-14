import { z } from 'zod';
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

const pendingUpdates = new Map< string, Promise< void > >();

function siteDetailsToServerDetails(
	site: SiteDetails,
	running: boolean
): SiteServer[ 'details' ] {
	return {
		...site,
		running,
	};
}

async function handleSiteEvent( event: SiteEvent ): Promise< void > {
	const { event: eventType, siteId, site, running } = event;
	const previous = pendingUpdates.get( siteId ) ?? Promise.resolve();
	const current = previous
		.catch( () => {} )
		.then( () => {
			if ( eventType === SITE_EVENTS.DELETED ) {
				SiteServer.unregister( siteId );
				return;
			}

			if ( ! site ) {
				return;
			}

			let server = SiteServer.get( siteId );

			if ( ! server ) {
				const existingServer = SiteServer.getByPath( site.path );
				if ( existingServer ) {
					server = existingServer;
				} else {
					server = SiteServer.register( siteDetailsToServerDetails( site, running ) );
					return;
				}
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
	pendingUpdates.set( siteId, current );
	await current;
}

export function startCliEventsSubscriber(): void {
	if ( subscriber ) {
		return;
	}

	subscriber = executeCliCommand( [ '_events' ], {
		output: 'ignore',
	} );
	const [ eventEmitter ] = subscriber;

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
		console.error( 'CLI events subscriber error:', error );
		subscriber = null;
	} );

	eventEmitter.on( 'failure', () => {
		console.warn( 'CLI events subscriber exited unexpectedly' );
		subscriber = null;
	} );
}

export function stopCliEventsSubscriber(): void {
	if ( subscriber ) {
		const [ , childProcess ] = subscriber;
		if ( childProcess.connected ) {
			childProcess.disconnect();
		}
		childProcess.kill();
		subscriber = null;
	}
}
