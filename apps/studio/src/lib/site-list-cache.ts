import { SITE_EVENTS, type SiteEvent, type SiteListItem } from '@studio/common/lib/cli-events';
import { listSites } from '@studio/common/sites/list';
import { executeCliCommand } from 'src/modules/cli/lib/execute-command';

// Changes no event reports (e.g. a crashed daemon) show up within this long, the
// interval the renderer polls the site list on.
export const SITE_LIST_MAX_AGE_MS = 2 * 60 * 1000;

/**
 * The CLI's site list, kept current by the `_events` stream so that reading it doesn't start a CLI
 * process each time. It's only used while the stream runs, and `drop()` discards it, so the next
 * read asks the CLI again.
 */
export function createSiteListCache( fetchSites: () => Promise< SiteListItem[] >, now = Date.now ) {
	let live = false;
	let sites: Map< string, SiteListItem > | undefined;
	let fetchedAt = 0;
	// The fetch that will become the cache, with the events that arrive while it runs.
	let pending: { promise: Promise< SiteListItem[] >; events: SiteEvent[] } | undefined;

	function drop() {
		sites = undefined;
		pending = undefined;
	}

	// Returns false when the event doesn't carry what's needed to apply it.
	function apply( list: Map< string, SiteListItem >, event: SiteEvent ): boolean {
		if ( event.event === SITE_EVENTS.DELETED ) {
			list.delete( event.siteId );
			return true;
		}
		if ( ! event.site ) {
			return false;
		}
		// The CLI reports `running` the way `site list` does.
		list.set( event.siteId, { ...event.site, running: event.running } );
		return true;
	}

	function fetchAndKeep(): Promise< SiteListItem[] > {
		const startedAt = now();
		const fetch = {
			// With the events that arrived meanwhile, which a reader that joined the fetch after an
			// event expects to see.
			promise: fetchSites().then( ( list ) => {
				const kept = new Map( list.map( ( site ) => [ site.id, site ] ) );
				if ( ! fetch.events.every( ( event ) => apply( kept, event ) ) ) {
					return list;
				}
				if ( pending === fetch && live ) {
					pending = undefined;
					sites = kept;
					fetchedAt = startedAt;
				}
				return [ ...kept.values() ];
			} ),
			events: [] as SiteEvent[],
		};
		fetch.promise.catch( () => {
			if ( pending === fetch ) {
				pending = undefined;
			}
		} );
		pending = fetch;
		return fetch.promise;
	}

	return {
		/** Whether the `_events` stream is running, so that its events keep the cache current. */
		setLive( value: boolean ) {
			live = value;
			drop();
		},

		drop,

		applyEvent( event: SiteEvent ) {
			pending?.events.push( event );
			if ( sites && ! apply( sites, event ) ) {
				drop();
			}
		},

		read(): Promise< SiteListItem[] > {
			if ( ! live ) {
				return fetchSites();
			}
			if ( sites && now() - fetchedAt < SITE_LIST_MAX_AGE_MS ) {
				return Promise.resolve( [ ...sites.values() ] );
			}
			return pending?.promise ?? fetchAndKeep();
		},
	};
}

// Kept current by the CLI events subscriber.
export const siteListCache = createSiteListCache( () => listSites( executeCliCommand ) );
