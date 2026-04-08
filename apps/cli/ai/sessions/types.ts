import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

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
			type: 'site.selected';
			timestamp: string;
			siteName: string;
			sitePath: string;
			remote?: boolean;
			url?: string;
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
			message: SDKMessage;
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
	  }
	| {
			type: 'plugin.installed';
			timestamp: string;
			pluginName: string;
			version: string;
			durationMs: number;
	  }
	| {
			type: 'plugin.update_available';
			timestamp: string;
			pluginName: string;
			currentVersion: string;
			availableVersion: string;
	  }
	| {
			type: 'plugin.updated';
			timestamp: string;
			pluginName: string;
			oldVersion: string;
			newVersion: string;
	  }
	| {
			type: 'plugin.load_failed';
			timestamp: string;
			pluginName: string;
			error: string;
	  }
	| {
			type: 'plugin.linked';
			timestamp: string;
			pluginName: string;
			path: string;
	  }
	| {
			type: 'plugin.unlinked';
			timestamp: string;
			pluginName: string;
	  };

export interface AiSessionSummary {
	id: string;
	filePath: string;
	createdAt: string;
	updatedAt: string;
	agentSessionId?: string;
	linkedAgentSessionIds: string[];
	firstPrompt?: string;
	selectedSiteName?: string;
	endReason?: 'error' | 'stopped';
	eventCount: number;
}

export interface LoadedAiSession {
	summary: AiSessionSummary;
	events: AiSessionEvent[];
}
