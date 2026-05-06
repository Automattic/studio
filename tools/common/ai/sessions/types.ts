import type { SessionEntryBase } from './entry-types';

export type TurnStatus = 'success' | 'error' | 'max_turns' | 'interrupted';

export interface AiSessionSummary {
	id: string;
	filePath: string;
	createdAt: string;
	updatedAt: string;
	agentSessionId?: string;
	linkedAgentSessionIds: string[];
	firstPrompt?: string;
	// The first local site the session attached to. Acts as the session's owner
	// in the UI sidebar. Undefined for sessions that only ever selected remote
	// sites, or that never selected any site at all.
	ownerSitePath?: string;
	ownerSiteName?: string;
	// The most recently selected site during the session. May differ from the
	// owner when the user switches between local and live (the owner stays
	// anchored to the first local pick).
	selectedSiteName?: string;
	// Which side of the owner site the next turn will act on. Derived from the
	// latest `studio.site_selected` custom entry (`remote === true` → 'live').
	// Consumers that care about disconnect fall-back (the renderer's
	// effective-env hook) also cross-check `lastSelectedWpcomSiteId` against
	// current connected-sites.
	activeEnvironment: 'local' | 'live';
	// The wpcomSiteId carried by the latest live `studio.site_selected`. Used
	// by the renderer's effective-env derivation to detect "live was
	// disconnected" without needing to re-scan entries.
	lastSelectedWpcomSiteId?: number;
	endReason?: 'error' | 'stopped';
	// Count of pi entries in the session JSONL (excluding the header).
	eventCount: number;
}

export interface LoadedAiSession {
	summary: AiSessionSummary;
	// On disk the session is pi-coding-agent's `SessionEntry`-based JSONL
	// (with Studio metadata as `studio.*` `CustomEntry` payloads). Renderer
	// consumers iterate `entries` directly.
	entries: SessionEntryBase[];
}
