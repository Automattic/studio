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
	// The site the session was first attached to. Acts as the session's owner
	// project in the UI sidebar. Undefined for sessions that never selected a site.
	ownerSitePath?: string;
	ownerSiteName?: string;
	// The most recently selected site during the session. May differ from the owner
	// if the user switched sites mid-session.
	selectedSiteName?: string;
	endReason?: 'error' | 'stopped';
	eventCount: number;
}

export interface LoadedAiSession {
	summary: AiSessionSummary;
	events: AiSessionEvent[];
}
