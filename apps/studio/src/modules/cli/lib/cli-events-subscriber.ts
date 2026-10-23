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
import { siteListCache } from 'src/lib/site-list-cache';
import { forgetSite, getSites } from 'src/lib/sites';
import { executeCliCommand, onCliCommandFinished } from 'src/modules/cli/lib/execute-command';

// The last running state of each site, so a site's thumbnail is captured when it starts only.
// Seeded from the site list once the events stream listens; a site missing from it is new, so stopped.
const lastRunning = new Map< string, boolean >();
let seeded: Promise< void > = Promise.resolve();

const handleSiteEvent = sequential( async ( event: SiteEvent ): Promise< void > => {
	const { event: eventType, siteId, site } = event;

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

	// A site serving a PHP-error page stays "running" even though the CLI reports it stopped.
	const running = event.running || isInErrorRecovery( siteId );
	void sendIpcEventToRenderer( 'site-event', { ...event, running } );
	await seeded;
	const wasRunning = lastRunning.get( siteId ) ?? false;
	lastRunning.set( siteId, running );

	if ( running && ! wasRunning ) {
		void captureSiteThumbnail( site );
	}
} );

let subscriber: ReturnType< typeof executeCliCommand > | null = null;
let watchingCommands = false;

// A command's changes can reach the events stream after it exits, so a site list read after a
// command asks the CLI again.
function dropSiteListAfterCommands() {
	if ( watchingCommands ) {
		return;
	}
	watchingCommands = true;
	onCliCommandFinished( ( [ command, subcommand ] ) => {
		if ( command !== '_events' && ! ( command === 'site' && subcommand === 'list' ) ) {
			siteListCache.drop();
		}
	} );
}

export async function startCliEventsSubscriber(): Promise< void > {
	if ( subscriber ) {
		return;
	}
	dropSiteListAfterCommands();

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

		let live = false;
		eventEmitter.on( 'data', ( { data } ) => {
			// Its first message comes once it listens for changes, so its events from then on are complete.
			if ( ! live ) {
				live = true;
				siteListCache.setLive( true );
				seeded = getSites()
					.then( ( sites ) => {
						for ( const site of sites ) {
							lastRunning.set( site.id, site.running );
						}
					} )
					.catch( () => undefined );
			}

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
			// Before the renderer hears of the event, so the site list it then reads includes it.
			siteListCache.applyEvent( siteEvent );
			void handleSiteEvent( siteEvent );
		} );

		eventEmitter.on( 'error', ( { error } ) => {
			siteListCache.setLive( false );
			reject( error );
			console.error( 'CLI events subscriber error:', error );
			subscriber = null;
		} );

		eventEmitter.on( 'failure', () => {
			siteListCache.setLive( false );
			console.warn( 'CLI events subscriber exited unexpectedly' );
			subscriber = null;
		} );
	} );
}

export function stopCliEventsSubscriber(): void {
	siteListCache.setLive( false );
	if ( subscriber ) {
		const [ eventEmitter, childProcess ] = subscriber;
		eventEmitter.removeAllListeners();
		childProcess.kill( 'SIGKILL' );
	}
}
