import type { SessionEntry } from '@mariozechner/pi-coding-agent';

export type TurnStatus = 'success' | 'error' | 'max_turns' | 'interrupted';

export interface AiSessionMetadata {
	starred?: boolean;
	archived?: boolean;
}

export interface AiSessionSummary extends AiSessionMetadata {
	id: string;
	filePath: string;
	createdAt: string;
	updatedAt: string;
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
	// Side of the owner site the next turn acts on. `remote === true` → 'live'.
	// Renderer's effective-env hook also checks `lastSelectedWpcomSiteId` against
	// current connected sites for disconnect fall-back.
	activeEnvironment: 'local' | 'live';
	lastSelectedWpcomSiteId?: number;
	endReason?: 'error' | 'stopped';
	eventCount: number;
}

export interface LoadedAiSession {
	summary: AiSessionSummary;
	entries: SessionEntry[];
}
