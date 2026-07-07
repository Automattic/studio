import type { StudioChatArtifactData } from './chat-artifacts';
import type { PermissionRequestData } from './tool-permissions';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

export type TurnCompletedStatus = 'success' | 'error' | 'paused' | 'max_turns';

// User-facing media payload emitted by tools like `share_screenshot`. The remote
// session controller forwards these to Telegram as photos; other consumers
// (desktop renderer, plain CLI) can ignore them.
export interface MediaShareEvent {
	type: 'media.share';
	timestamp: string;
	mediaType: 'image';
	mimeType: 'image/png' | 'image/jpeg';
	dataBase64: string;
	caption?: string;
}

export interface AgentMessageJsonEvent {
	type: 'message';
	timestamp: string;
	message: AgentSessionEvent;
}

export type JsonEvent =
	| AgentMessageJsonEvent
	| { type: 'progress'; timestamp: string; message: string }
	| { type: 'info'; timestamp: string; message: string }
	| { type: 'error'; timestamp: string; message: string }
	| { type: 'chat.artifact'; timestamp: string; artifact: StudioChatArtifactData }
	| { type: 'preview.reload'; timestamp: string }
	// Agent-placed highlight markers in the site preview (the reverse of the
	// user's clips): "I changed *this*". Selectors resolve in the guest page;
	// an empty array clears the previous set.
	| {
			type: 'preview.highlight';
			timestamp: string;
			markers: Array< { id: string; selector: string; label?: string } >;
	  }
	| {
			type: 'question.asked';
			timestamp: string;
			questions: Array< {
				question: string;
				options: Array< { label: string; description: string } >;
			} >;
	  }
	| {
			// A gated tool call is blocked awaiting user confirmation. Deliberately
			// distinct from `question.asked`: renderers style it as a warning, offer
			// fixed decisions instead of options, and treat dismissal as deny.
			type: 'permission.requested';
			timestamp: string;
			request: PermissionRequestData;
	  }
	| { type: 'turn.started'; timestamp: string }
	| {
			type: 'turn.completed';
			timestamp: string;
			sessionId: string;
			status: TurnCompletedStatus;
			usage?: { numTurns: number; costUsd?: number };
	  }
	| MediaShareEvent;
