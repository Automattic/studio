export type TurnStatus = 'success' | 'error' | 'max_turns' | 'interrupted';

export type AiSessionEvent =
	| {
			type: 'session.started';
			timestamp: string;
			version: 1;
			sessionId: string;
	  }
	| {
			type: 'session.linked';
			timestamp: string;
			agentSessionId: string;
	  }
	| {
			type: 'session.context';
			timestamp: string;
			provider: string;
			model: string;
	  }
	| {
			// User-initiated model override (e.g. the composer dropdown in the
			// desktop UI). The CLI prefers this over `session.context.model` on
			// resume so the next turn uses the selected model.
			type: 'session.model_selected';
			timestamp: string;
			model: string;
	  }
	| {
			type: 'session.cleared';
			timestamp: string;
	  }
	| {
			// The site the next turn will act on. `remote` + `wpcomSiteId` together
			// mean "the linked WordPress.com site"; otherwise `sitePath` identifies
			// a local site. Writers emit a fresh `site.selected` for every flip so
			// the log is self-describing — there's no separate "environment"
			// concept, the event itself carries the whole state.
			type: 'site.selected';
			timestamp: string;
			siteName: string;
			sitePath: string;
			remote?: boolean;
			url?: string;
			wpcomSiteId?: number;
	  }
	| {
			type: 'user.message';
			timestamp: string;
			text: string;
			source: 'prompt' | 'ask_user';
			sitePath?: string;
	  }
	| {
			type: 'sdk.message';
			timestamp: string;
			// Opaque SDK message payload. Only the CLI (which owns the Claude Agent SDK)
			// narrows this to `SDKMessage`; other consumers treat it as arbitrary JSON.
			message: unknown;
	  }
	| {
			type: 'tool.progress';
			timestamp: string;
			message: string;
	  }
	| {
			type: 'agent.question';
			timestamp: string;
			question: string;
			options: Array< {
				label: string;
				description: string;
			} >;
	  }
	| {
			type: 'turn.closed';
			timestamp: string;
			status: TurnStatus;
	  };

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
	// latest `site.selected` event (`remote === true` → 'live'). Consumers that
	// care about disconnect fall-back (the renderer's effective-env hook) also
	// cross-check `lastSelectedWpcomSiteId` against current connected-sites.
	activeEnvironment: 'local' | 'live';
	// The wpcomSiteId carried by the latest live `site.selected`. Used by the
	// renderer's effective-env derivation to detect "live was disconnected"
	// without needing to re-scan events.
	lastSelectedWpcomSiteId?: number;
	endReason?: 'error' | 'stopped';
	eventCount: number;
}

export interface LoadedAiSession {
	summary: AiSessionSummary;
	// Pi-format session entries (the post-migration shape). Phase 2 of the
	// pi-session adoption replaces the legacy `events: AiSessionEvent[]` here;
	// the renderer reads pi entries directly via the `entry-types` mirror.
	entries: import('./entry-types').PiSessionEntry[];
	// Backward-compat alias for in-flight code paths that still iterate the
	// legacy event stream (apps/ui renderer + summary helpers). Removed once
	// those callers move to `entries`.
	events: AiSessionEvent[];
}
