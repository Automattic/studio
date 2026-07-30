import type { SessionEntry } from '@earendil-works/pi-coding-agent';

export type TurnStatus = 'success' | 'error' | 'max_turns' | 'interrupted';

export interface AiSessionMetadata {
	archived?: boolean;
}

export interface AiSessionSummary extends AiSessionMetadata {
	id: string;
	filePath: string;
	createdAt: string;
	updatedAt: string;
	firstPrompt?: string;
	assistantReplyPreview?: string;
	// Desktop-only placement, hydrated by the app from app.json. CLI session
	// summaries do not infer ownership from active-site history. Matching is by
	// ownerSiteId; ownerSitePath/ownerSiteName are kept for display and as a
	// fallback for placements written before siteId existed.
	ownerSiteId?: string;
	ownerSitePath?: string;
	ownerSiteName?: string;
	// The most recently selected execution target during the session.
	selectedSiteName?: string;
	// Side of the current execution target the next turn acts on. `remote === true` → 'live'.
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
