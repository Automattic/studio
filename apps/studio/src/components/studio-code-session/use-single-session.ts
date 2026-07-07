import { useCallback, useEffect, useState } from 'react';
import { getIpcApi } from 'src/lib/get-ipc-api';

// One Studio Code session per site. There is no session list in the tab, so
// we persist a single session id per site; the assistant tab reopens the same
// conversation, and "New conversation" swaps in a fresh session id. The
// transcript itself lives on disk (CLI session store); this only remembers
// which session id belongs to which site.
const STORAGE_KEY = 'studio_code_session_ids';

function loadStored( siteId: string ): string | null {
	try {
		const raw = localStorage.getItem( STORAGE_KEY );
		if ( ! raw ) {
			return null;
		}
		const map = JSON.parse( raw ) as Record< string, string >;
		return map[ siteId ] ?? null;
	} catch {
		return null;
	}
}

// Map a site to a session id. Exported so the site-creation switch flow can
// hand a migrated conversation to the newly created site before navigating to
// it (the new site's `useSingleSession` then bootstraps onto that session
// instead of creating a fresh one).
export function setStoredSessionId( siteId: string, sessionId: string ): void {
	try {
		const raw = localStorage.getItem( STORAGE_KEY );
		const map = raw ? ( JSON.parse( raw ) as Record< string, string > ) : {};
		map[ siteId ] = sessionId;
		localStorage.setItem( STORAGE_KEY, JSON.stringify( map ) );
	} catch {
		// Ignore storage errors.
	}
}

// Forget a site's stored session. Used when a conversation migrates to a newly
// created site so the original site no longer points at the moved session and
// bootstraps a fresh one on next open.
export function clearStoredSessionId( siteId: string ): void {
	try {
		const raw = localStorage.getItem( STORAGE_KEY );
		if ( ! raw ) {
			return;
		}
		const map = JSON.parse( raw ) as Record< string, string >;
		if ( ! ( siteId in map ) ) {
			return;
		}
		delete map[ siteId ];
		localStorage.setItem( STORAGE_KEY, JSON.stringify( map ) );
	} catch {
		// Ignore storage errors.
	}
}

export interface SingleSession {
	sessionId: string | undefined;
	setSessionId: ( id: string ) => void;
	newSession: () => Promise< void >;
}

export function useSingleSession( siteId: string ): SingleSession {
	const [ sessionId, setSessionIdState ] = useState< string | undefined >(
		() => loadStored( siteId ) ?? undefined
	);

	const setSessionId = useCallback(
		( id: string ) => {
			setStoredSessionId( siteId, id );
			setSessionIdState( id );
		},
		[ siteId ]
	);

	// Bootstrap: reuse the stored session for this site, or create one.
	useEffect( () => {
		let cancelled = false;
		const stored = loadStored( siteId );
		if ( stored ) {
			setSessionIdState( stored );
			return;
		}
		void getIpcApi()
			.createAiSession( siteId )
			.then( ( summary ) => {
				if ( cancelled ) {
					return;
				}
				setStoredSessionId( siteId, summary.id );
				setSessionIdState( summary.id );
			} )
			.catch( () => {
				// Leaves sessionId undefined; the view shows its loading state
				// and the next render retries on remount.
			} );
		return () => {
			cancelled = true;
		};
	}, [ siteId ] );

	const newSession = useCallback( async () => {
		const summary = await getIpcApi().createAiSession( siteId );
		setSessionId( summary.id );
	}, [ siteId, setSessionId ] );

	return { sessionId, setSessionId, newSession };
}
