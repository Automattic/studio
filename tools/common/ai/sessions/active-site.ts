import { isStudioCustomEntryOfType } from './entry-types';
import type { SessionEntry } from '@earendil-works/pi-coding-agent';

export interface ResolvedActiveSite {
	name: string;
	path: string;
	remote: boolean;
	url?: string;
	wpcomSiteId?: number;
}

// The most recent `studio.site_selected` wins. Used by the JSON adapter to
// hydrate `ui.activeSite` before dispatching a turn (no replay loop there).
export function resolveActiveSiteFromEntries(
	entries: SessionEntry[]
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
