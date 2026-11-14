import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { StudioChatArtifactData } from '@studio/agent/protocol/chat-artifacts';

export type TurnCompletedStatus = 'success' | 'error' | 'paused' | 'max_turns';

export interface AgentMessageJsonEvent {
	type: 'message';
	timestamp: string;
	message: AgentSessionEvent;
}

export type JsonEvent =
	| AgentMessageJsonEvent
	| { type: 'info'; timestamp: string; message: string }
	| { type: 'error'; timestamp: string; message: string }
	| { type: 'chat.artifact'; timestamp: string; artifact: StudioChatArtifactData }
	| {
			type: 'question.asked';
			timestamp: string;
			questions: Array< {
				question: string;
				options: Array< { label: string; description: string; image?: string } >;
				multiSelect?: boolean;
			} >;
	  }
	| { type: 'preview.reload'; timestamp: string }
	| { type: 'turn.started'; timestamp: string }
	| {
			type: 'turn.completed';
			turnId?: string;
			edits?: number;
			timestamp: string;
			sessionId: string;
			status: TurnCompletedStatus;
			usage?: { numTurns: number; costUsd?: number };
	  };
