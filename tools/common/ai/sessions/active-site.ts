import type { AiSessionEvent } from './types';

export interface ResolvedActiveSite {
	name: string;
	path: string;
	remote: boolean;
	url?: string;
	wpcomSiteId?: number;
}

/**
 * Walks a session's events and returns the site the next turn should act on.
 * Tracks the latest `site.selected`; `environment.selected` (a legacy event
 * from an earlier iteration of the apps/ui environment switcher) flips the
 * environment over the most recent site without changing its name/path. The
 * CLI's JSON adapter has no replay loop, so it relies on this helper to
 * hydrate `ui.activeSite` before dispatching a new turn.
 */
export function resolveActiveSiteFromEvents(
	events: AiSessionEvent[]
): ResolvedActiveSite | undefined {
	let state: ResolvedActiveSite | undefined;

	for ( const event of events ) {
		if ( event.type === 'site.selected' ) {
			state = {
				name: event.siteName,
				path: event.sitePath,
				remote: event.remote === true,
				url: event.url,
				wpcomSiteId: event.wpcomSiteId,
			};
			continue;
		}

		if ( event.type === 'environment.selected' && state ) {
			const isLive = event.environment === 'live';
			state = {
				name: state.name,
				path: state.path,
				remote: isLive,
				url: isLive ? event.url : undefined,
				wpcomSiteId: isLive ? event.wpcomSiteId : undefined,
			};
		}
	}

	return state;
}
