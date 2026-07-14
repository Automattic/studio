import type { AiSessionSummary } from './types';

type OwnerRef = Pick< AiSessionSummary, 'ownerSiteId' | 'ownerSitePath' >;

// A session with an ownerSiteId never matches by path — a dead id must not
// rebind to a new site created at the same folder. Path matching only covers
// placements written before siteId existed.
export function aiSessionBelongsToSite(
	session: OwnerRef,
	site: { id: string; path: string }
): boolean {
	return session.ownerSiteId
		? session.ownerSiteId === site.id
		: session.ownerSitePath === site.path;
}

export function findAiSessionOwnerSite< T extends { id: string; path: string } >(
	sites: T[] | undefined,
	session: OwnerRef | undefined
): T | undefined {
	if ( ! session ) {
		return undefined;
	}
	return sites?.find( ( site ) => aiSessionBelongsToSite( session, site ) );
}
