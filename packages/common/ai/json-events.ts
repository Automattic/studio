import type { StudioChatArtifactData } from './chat-artifacts';
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
	| {
			type: 'question.asked';
			timestamp: string;
			questions: Array< {
				question: string;
				options: Array< { label: string; description: string } >;
			} >;
	  }
	| { type: 'turn.started'; timestamp: string }
	// Reply to a `steer` IPC message: whether the mid-turn user message reached
	// the live turn. When false the sender should resend it as a normal prompt.
	| { type: 'steer.result'; timestamp: string; delivered: boolean; text: string }
	| {
			type: 'turn.completed';
			timestamp: string;
			sessionId: string;
			status: TurnCompletedStatus;
			usage?: { numTurns: number; costUsd?: number };
	  }
	| MediaShareEvent;

const USAGE_CAP_PATTERN = /(?:API Error:\s*429\b|status code\s+429\b|"status"\s*:\s*429\b)/i;

/**
 * Returns true when an error message indicates the user hit the AI usage cap
 * (HTTP 429 from the WordPress.com proxy).
 */
export function isUsageCapError( message: string | undefined | null ): boolean {
	return USAGE_CAP_PATTERN.test( message ?? '' );
}
