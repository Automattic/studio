import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { pickLiveSite, sortConnections } from './utils';
import type { SyncSite } from '@/data/core';

// The toolbar's action is a mode, not a menu of one-shot commands: it moves
// content in one direction, with one of the site's connections. A local site
// can be connected to both a production site and its staging sibling, and
// pushing to the wrong one is the expensive mistake this exists to prevent —
// so both halves of the mode are shown on the button and remembered per site.

export type SyncModeDirection = 'push' | 'pull';

const DIRECTION_KEY = 'studio:sync-direction:';
const TARGET_KEY = 'studio:sync-target:';

const listeners = new Set< () => void >();

// Read straight through rather than caching: the stored value is the source of
// truth, `getSnapshot` compares by value, and two `getItem` calls per render is
// nothing next to the confusion a stale copy would cause.
function read( key: string ): string | undefined {
	try {
		return globalThis.localStorage?.getItem( key ) ?? undefined;
	} catch {
		return undefined;
	}
}

function write( key: string, value: string ): void {
	try {
		globalThis.localStorage?.setItem( key, value );
	} catch {
		// A remembered choice is a convenience; losing it isn't worth failing over.
	}
	for ( const listener of listeners ) {
		listener();
	}
}

function subscribe( listener: () => void ): () => void {
	listeners.add( listener );
	return () => {
		listeners.delete( listener );
	};
}

function useStoredValue( key: string ): string | undefined {
	return useSyncExternalStore(
		subscribe,
		() => read( key ),
		() => undefined
	);
}

export type SyncMode = {
	direction: SyncModeDirection;
	setDirection: ( direction: SyncModeDirection ) => void;
	// Every connection this local site has, production first.
	targets: SyncSite[];
	// The one the toolbar acts on. Falls back to production whenever the stored
	// choice names a connection that no longer exists.
	target: SyncSite | undefined;
	selectTarget: ( remoteSiteId: number ) => void;
};

export function useSyncMode(
	localSiteId: string,
	connectedSites: SyncSite[] | undefined
): SyncMode {
	const storedDirection = useStoredValue( `${ DIRECTION_KEY }${ localSiteId }` );
	const storedTarget = useStoredValue( `${ TARGET_KEY }${ localSiteId }` );

	const targets = useMemo( () => sortConnections( connectedSites ), [ connectedSites ] );
	const target = useMemo(
		() =>
			targets.find( ( candidate ) => String( candidate.id ) === storedTarget ) ??
			pickLiveSite( targets ),
		[ targets, storedTarget ]
	);

	const setDirection = useCallback(
		( direction: SyncModeDirection ) => write( `${ DIRECTION_KEY }${ localSiteId }`, direction ),
		[ localSiteId ]
	);
	const selectTarget = useCallback(
		( remoteSiteId: number ) => write( `${ TARGET_KEY }${ localSiteId }`, String( remoteSiteId ) ),
		[ localSiteId ]
	);

	return {
		direction: storedDirection === 'pull' ? 'pull' : 'push',
		setDirection,
		targets,
		target,
		selectTarget,
	};
}
