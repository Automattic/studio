/**
 * Remembers the most recently visited site, and the chat last open in each
 * site, so the `/` index route and the sidebar return the user to them. Ids
 * are validated against live data when read, so a stale one (a deleted site,
 * an archived chat) just falls through.
 */

interface LastVisited {
	siteId?: string;
	chats?: Record< string, string | null >;
}

const STORAGE_KEY = 'studio-ui-last-visited-v1';

export function readLastVisited(): LastVisited {
	try {
		const stored = window.localStorage.getItem( STORAGE_KEY );
		const parsed = stored ? JSON.parse( stored ) : {};
		return {
			siteId: typeof parsed.siteId === 'string' ? parsed.siteId : undefined,
			chats: parsed.chats && typeof parsed.chats === 'object' ? parsed.chats : undefined,
		};
	} catch {
		return {};
	}
}

export function rememberVisit( siteId: string, sessionId?: string | null ): void {
	const { chats } = readLastVisited();
	try {
		window.localStorage.setItem(
			STORAGE_KEY,
			JSON.stringify( {
				siteId,
				chats: sessionId !== undefined ? { ...chats, [ siteId ]: sessionId } : chats,
			} )
		);
	} catch {
		// Best-effort; without it the index route falls back to the first site.
	}
}

/** The site's chat to reopen: the one last open, else its most recent. */
export function resumeChat< T extends { id: string } >(
	siteId: string,
	chats: T[]
): T | undefined {
	const lastId = readLastVisited().chats?.[ siteId ];
	if ( lastId === null ) return undefined;
	return chats.find( ( chat ) => chat.id === lastId ) ?? chats[ 0 ];
}
