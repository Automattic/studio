import {
	AUTH_EVENTS,
	cliAuthEventSchema,
	cliSiteEventSchema,
	cliSnapshotEventSchema,
	SiteEvent,
	SITE_EVENTS,
	SiteDetails,
} from '@studio/common/lib/cli-events';
import { sequential } from '@studio/common/lib/sequential';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { captureSiteThumbnail } from 'src/lib/capture-site-thumbnail';
import { executeCliCommand } from 'src/modules/cli/lib/execute-command';
import { SiteServer } from 'src/site-server';

// Fields owned by Studio that the CLI never emits and that must survive a
// site-event merge (TLS material, renderer-computed theme info, sort order,
// auto-start preference, transient runtime flags).
const STUDIO_ONLY_DETAIL_KEYS = [
	'tlsKey',
	'tlsCert',
	'themeDetails',
	'siteIconPath',
	'sortOrder',
	'autoStart',
	'isAddingSite',
	'latestCliPid',
] as const satisfies readonly ( keyof SiteServer[ 'details' ] )[];

function pickStudioOnlyDetails( details?: SiteServer[ 'details' ] ) {
	if ( ! details ) {
		return {} as Partial< SiteServer[ 'details' ] >;
	}
	const picked: Partial< SiteServer[ 'details' ] > = {};
	for ( const key of STUDIO_ONLY_DETAIL_KEYS ) {
		const value = details[ key ];
		if ( value !== undefined ) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			( picked as any )[ key ] = value;
		}
	}
	return picked;
}

// The CLI event is the authoritative snapshot for every field in the shared
// `siteDetailsSchema`. JSON serialization drops `undefined` values, so a
// field that's been cleared (e.g. `customDomain` after `site set --domain ''`)
// arrives here as an absent key. Spreading `...existingDetails` first would
// then preserve the stale value. Invert the merge: start from Studio-only
// fields, then let the CLI payload set or omit everything else.
function siteDetailsToServerDetails(
	site: SiteDetails,
	running: boolean,
	existingDetails?: SiteServer[ 'details' ]
): SiteServer[ 'details' ] {
	return {
		...pickStudioOnlyDetails( existingDetails ),
		...site,
		running,
	};
}

const handleSiteEvent = sequential( async ( event: SiteEvent ): Promise< void > => {
	const { event: eventType, siteId, site, running } = event;

	if ( eventType === SITE_EVENTS.DELETED ) {
		await SiteServer.unregister( siteId );
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
		if ( running ) {
			void captureSiteThumbnail( siteId );
			// A freshly created site that's running should auto-start on the next Studio launch.
			await SiteServer.get( siteId )?.persistAutoStart( true );
		}
		return;
	}

	// For UPDATED events, update existing server details
	const server = SiteServer.get( siteId ) ?? SiteServer.getByPath( site.path );
	if ( ! server ) {
		console.warn( `Received UPDATED event for unknown site: ${ siteId }` );
		return;
	}

	const wasNotRunning = ! server.details.running;
	server.details = siteDetailsToServerDetails( site, running, server.details );

	if ( server.server && site.url ) {
		server.server.url = site.url;
	}

	void sendIpcEventToRenderer( 'site-event', event );

	if ( wasNotRunning && running ) {
		void captureSiteThumbnail( siteId );
		await server.getThemeDetails();
		await server.getSiteIcon();
		// Mirror "is running" into the Studio-owned autoStart flag so the site resumes next launch.
		await server.persistAutoStart( true );
	} else if ( ! wasNotRunning && ! running ) {
		await server.persistAutoStart( false );
	}
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
			const authParsed = cliAuthEventSchema.safeParse( data );
			if ( authParsed.success ) {
				const { event, token } = authParsed.data.value;
				if ( event === AUTH_EVENTS.LOGIN && token ) {
					void sendIpcEventToRenderer( 'auth-updated', { token } );
				} else {
					void sendIpcEventToRenderer( 'auth-updated', { token: null } );
				}
				return;
			}

			const snapshotParsed = cliSnapshotEventSchema.safeParse( data );
			if ( snapshotParsed.success ) {
				void sendIpcEventToRenderer( 'snapshot-event', snapshotParsed.data.value );
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
