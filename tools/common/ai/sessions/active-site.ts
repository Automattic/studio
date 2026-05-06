import { isStudioCustomEntryOfType, type SessionEntryBase } from './entry-types';

export interface ResolvedActiveSite {
	name: string;
	path: string;
	remote: boolean;
	url?: string;
	wpcomSiteId?: number;
}

/**
 * Walks a session's pi entries and returns the site the next turn should
 * act on — the most recent `studio.site_selected` custom entry wins. The
 * CLI's JSON adapter has no replay loop, so it relies on this helper to
 * hydrate `ui.activeSite` before dispatching a new turn.
 */
export function resolveActiveSiteFromEntries(
	entries: SessionEntryBase[]
): ResolvedActiveSite | undefined {
	let state: ResolvedActiveSite | undefined;

	for ( const entry of entries ) {
		if ( ! isStudioCustomEntryOfType( entry, 'studio.site_selected' ) ) continue;
		const data = entry.data;
		if ( ! data ) continue;
		state = {
			name: data.siteName,
			path: data.sitePath,
			remote: data.remote === true,
			url: data.url,
			wpcomSiteId: data.wpcomSiteId,
		};
	}

	return state;
}
