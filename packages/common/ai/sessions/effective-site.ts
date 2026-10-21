import type { AiSessionSummary } from './types';
import type { SyncSite } from '@studio/common/types/sync';

/**
 * Derive the effective environment for a session's next turn. Joins the
 * session's stored intent (latest `site.selected`) with the caller's current
 * connected-sites snapshot — a live-mode session whose remote has since been
 * disconnected naturally falls back to 'local' without any cleanup write.
 *
 * @param summary         The session summary produced by the reducer.
 * @param isLiveConnected Predicate returning true if the given wpcom blog id is
 *                        currently in the local site's connected-sites list.
 *                        Callers inject this from their connected-sites view.
 */
export function deriveEffectiveEnvironment(
	summary: Pick< AiSessionSummary, 'activeEnvironment' | 'lastSelectedWpcomSiteId' >,
	isLiveConnected: ( wpcomBlogId: number ) => boolean
): 'local' | 'live' {
	if ( summary.activeEnvironment !== 'live' ) {
		return 'local';
	}
	if ( summary.lastSelectedWpcomSiteId === undefined ) {
		return 'local';
	}
	return isLiveConnected( summary.lastSelectedWpcomSiteId ) ? 'live' : 'local';
}

// The site a chat works on when switched to Live: the production connection,
// else the first connected site.
export function pickLiveSite< T extends Pick< SyncSite, 'isStaging' > >(
	connected: T[]
): T | undefined {
	return connected.find( ( site ) => ! site.isStaging ) ?? connected[ 0 ];
}
