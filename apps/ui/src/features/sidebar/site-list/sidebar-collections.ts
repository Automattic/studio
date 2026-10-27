import { findAiSessionOwnerSite } from '@studio/common/ai/sessions/owner-site';
import {
	getDefaultSidebarChatSort,
	type SidebarPinnedSort,
	type SidebarSiteSort,
	type SidebarChatSort,
} from '@studio/common/lib/user-settings/preferences';
import { chatPinKey, orderChats, sitePinKey } from '@/data/queries/use-sidebar-pins';
import type { AiSessionSummary, SiteDetails } from '@/data/core';

export type SiteRow = {
	site: SiteDetails;
	sessionIds: string[];
	// Non-archived, most recent first.
	chats: AiSessionSummary[];
};

export type PinnedItem =
	| { key: string; row: SiteRow; session?: undefined; siteName?: undefined }
	| { key: string; row?: undefined; session: AiSessionSummary; siteName?: string };

// Recent is a shortcut to the latest chats; every chat is also under its site.
const RECENT_CHATS_LIMIT = 10;

function getTimestamp( session: AiSessionSummary | undefined ): number {
	return session ? Date.parse( session.updatedAt ) || 0 : 0;
}

function byMostRecent( a: AiSessionSummary, b: AiSessionSummary ): number {
	return getTimestamp( b ) - getTimestamp( a );
}

// A new chat isn't listed until its first prompt, unless it's open.
export function getListedSessions(
	sessions: AiSessionSummary[] | undefined,
	activeSessionId: string | undefined
): AiSessionSummary[] | undefined {
	return sessions?.filter(
		( session ) => session.firstPrompt || session.title || session.id === activeSessionId
	);
}

export function createSiteRows(
	sites: SiteDetails[] | undefined,
	sessions: AiSessionSummary[] | undefined
): SiteRow[] {
	const rows: SiteRow[] = ( sites ?? [] ).map( ( site ) => ( {
		site,
		sessionIds: [],
		chats: [],
	} ) );
	const rowsBySiteId = new Map( rows.map( ( row ) => [ row.site.id, row ] ) );

	for ( const session of sessions ?? [] ) {
		const ownerSite = findAiSessionOwnerSite( sites, session );
		const row = ownerSite ? rowsBySiteId.get( ownerSite.id ) : undefined;
		if ( ! row ) {
			continue;
		}
		row.sessionIds.push( session.id );
		if ( ! session.archived ) {
			row.chats.push( session );
		}
	}

	for ( const row of rows ) {
		row.chats.sort( byMostRecent );
	}

	return rows;
}

function findSessionSiteRow( rows: SiteRow[], sessionId: string ): SiteRow | undefined {
	return rows.find( ( row ) => row.sessionIds.includes( sessionId ) );
}

// The site a chat or new-chat route belongs to, and the site whose own page
// (overview or settings) is open.
export function getActiveSiteKeys(
	rows: SiteRow[],
	{
		activeSessionId,
		activeSiteId,
		pathname,
	}: { activeSessionId?: string; activeSiteId?: string; pathname: string }
): { chat?: string; context?: string } {
	const chat =
		( activeSessionId ? findSessionSiteRow( rows, activeSessionId )?.site.id : undefined ) ||
		( activeSiteId && pathname === `/sites/${ activeSiteId }/new` ? activeSiteId : undefined );
	// Site ids are UUIDs, so no URL decoding is needed to compare the path.
	const settings =
		activeSiteId && pathname === `/sites/${ activeSiteId }/settings` ? activeSiteId : undefined;
	const context =
		settings ??
		( activeSiteId && pathname === `/sites/${ activeSiteId }` ? activeSiteId : undefined );
	return { chat, context };
}

// Pinned sites and chats move out of their usual place into the Pinned group,
// and a chat waiting on an answer shows once, under Needs input.
export function getSidebarCollections(
	rows: SiteRow[],
	sessions: AiSessionSummary[] | undefined,
	{
		pins,
		chatOrder,
		needingInput,
		pinnedSort = 'type',
		siteSort = 'manual',
		chatSort = getDefaultSidebarChatSort( chatOrder ),
	}: {
		pins: string[];
		chatOrder: Record< string, string[] | undefined >;
		needingInput: string[];
		pinnedSort?: SidebarPinnedSort;
		siteSort?: SidebarSiteSort;
		chatSort?: SidebarChatSort;
	}
) {
	const pinned = new Set( pins );
	const isChatPinned = ( session: AiSessionSummary ) => pinned.has( chatPinKey( session.id ) );
	const rowsById = new Map( rows.map( ( row ) => [ row.site.id, row ] ) );
	const sessionsById = new Map( ( sessions ?? [] ).map( ( session ) => [ session.id, session ] ) );

	const pinnedItems = [ ...pinned ].flatMap< PinnedItem >( ( key ) => {
		const id = key.slice( key.indexOf( ':' ) + 1 );
		const row = key === sitePinKey( id ) ? rowsById.get( id ) : undefined;
		const session = key === chatPinKey( id ) ? sessionsById.get( id ) : undefined;
		if ( row ) {
			return [ { key, row } ];
		}
		return session && ! session.archived && ! needingInput.includes( session.id )
			? [ { key, session, siteName: findSessionSiteRow( rows, session.id )?.site.name } ]
			: [];
	} );
	if ( pinnedSort === 'type' ) {
		pinnedItems.sort( ( a, b ) => Number( !! b.row ) - Number( !! a.row ) );
	}
	const siteRows = rows.filter( ( row ) => ! pinned.has( sitePinKey( row.site.id ) ) );
	if ( siteSort === 'status' ) {
		siteRows.sort( ( a, b ) => Number( b.site.running ) - Number( a.site.running ) );
	}
	const chatsBySite = new Map(
		rows.map( ( row ) => [
			row.site.id,
			orderChats(
				row.chats.filter(
					( session ) => ! isChatPinned( session ) && ! needingInput.includes( session.id )
				),
				chatSort === 'manual' ? chatOrder[ row.site.id ] : undefined
			),
		] )
	);

	const openChats = ( sessions ?? [] )
		.filter( ( session ) => ! session.archived )
		.sort( byMostRecent );
	// Chats waiting on an answer move to the top until it's given.
	const needsInputChats = openChats.filter( ( session ) => needingInput.includes( session.id ) );
	const recentChats = openChats
		.filter( ( session ) => ! needingInput.includes( session.id ) && ! isChatPinned( session ) )
		.slice( 0, RECENT_CHATS_LIMIT );

	return { pinnedItems, siteRows, chatsBySite, needsInputChats, recentChats };
}

// Opening a site unfolds its chats and, unless the user turned it off, folds
// the others.
export function revealSite(
	revealed: ReadonlySet< string >,
	siteId: string,
	autoCollapse: boolean
): ReadonlySet< string > {
	return new Set( autoCollapse ? [ siteId ] : [ ...revealed, siteId ] );
}

// Clicking the open site again folds it.
export function toggleRevealedSite(
	revealed: ReadonlySet< string >,
	siteId: string,
	activeSiteKey: string | undefined,
	autoCollapse: boolean
): ReadonlySet< string > {
	return siteId === activeSiteKey && revealed.has( siteId )
		? new Set( [ ...revealed ].filter( ( id ) => id !== siteId ) )
		: revealSite( revealed, siteId, autoCollapse );
}

export function hasSeveralUnfoldedSites(
	siteRows: SiteRow[],
	chatsBySite: Map< string, AiSessionSummary[] >,
	revealed: ReadonlySet< string >
): boolean {
	return (
		siteRows.filter(
			( row ) => revealed.has( row.site.id ) && ( chatsBySite.get( row.site.id )?.length ?? 0 ) > 0
		).length > 1
	);
}

// A drag reorders only the chats on show; the rest keep their places.
export function mergeVisibleOrder( ids: string[], reorderedVisibleIds: string[] ): string[] {
	const moved = [ ...reorderedVisibleIds ];
	const visible = new Set( reorderedVisibleIds );
	return ids.map( ( id ) => ( visible.has( id ) ? moved.shift()! : id ) );
}
