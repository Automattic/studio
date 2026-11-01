import {
	AUTH_EVENTS,
	cliAuthEventSchema,
	cliSiteEventSchema,
	cliSnapshotEventSchema,
	cliSyncEventSchema,
	SiteEvent,
	SITE_EVENTS,
} from '@studio/common/lib/cli-events';
import { sequential } from '@studio/common/lib/sequential';
import { sendIpcEventToRenderer } from 'src/ipc-utils';
import { trackSyncActivity } from 'src/lib/active-sync-operations';
import { captureSiteThumbnail } from 'src/lib/capture-site-thumbnail';
import { isInErrorRecovery } from 'src/lib/php-error-recovery';
import { refreshHeadlessSiteOrigins } from 'src/lib/site-preview-origins';
import { forgetSite, getSites } from 'src/lib/sites';
import { executeCliCommand } from 'src/modules/cli/lib/execute-command';

// The last running state of each site, so a site's thumbnail is captured when it starts only.
// Seeded from the site list when the subscriber starts; a site missing from it is new, so stopped.
const lastRunning = new Map< string, boolean >();
let seeded: Promise< void > = Promise.resolve();

const handleSiteEvent = sequential( async ( event: SiteEvent ): Promise< void > => {
	const { event: eventType, siteId, site } = event;

	if ( eventType !== SITE_EVENTS.OPERATIONS_CHANGED ) {
		void refreshHeadlessSiteOrigins();
	}

	if ( eventType === SITE_EVENTS.DELETED ) {
		lastRunning.delete( siteId );
		void sendIpcEventToRenderer( 'site-event', event );
		await forgetSite( siteId );
		return;
	}

	if ( ! site ) {
		return;
	}

	// This event says nothing about whether the site is running, so it must not
	// count as a start below.
	if ( eventType === SITE_EVENTS.OPERATIONS_CHANGED ) {
		void sendIpcEventToRenderer( 'site-event', event );
		return;
	}

	// A site serving a PHP-error page stays "running" even though the CLI reports it stopped. Its
	// details go without, so the renderer refetches the list, where `getSites` gives the page's URL.
	const inErrorRecovery = isInErrorRecovery( siteId );
	const running = event.running || inErrorRecovery;
	void sendIpcEventToRenderer(
		'site-event',
		inErrorRecovery ? { event: eventType, siteId, running } : { ...event, running }
	);
	await seeded;
	const wasRunning = lastRunning.get( siteId ) ?? false;
	lastRunning.set( siteId, running );

	if ( running && ! wasRunning ) {
		void captureSiteThumbnail( site );
	}
} );

let subscriber: ReturnType< typeof executeCliCommand > | null = null;

export async function startCliEventsSubscriber(): Promise< void > {
	if ( subscriber ) {
		return;
	}
	seeded = getSites()
		.then( ( sites ) => {
			for ( const site of sites ) {
				lastRunning.set( site.id, site.running );
			}
		} )
		.catch( () => undefined );

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

			const syncParsed = cliSyncEventSchema.safeParse( data );
			if ( syncParsed.success ) {
				trackSyncActivity( syncParsed.data.value );
				void sendIpcEventToRenderer( 'sync-activity', syncParsed.data.value );
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
