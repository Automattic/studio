// Mirrors the subset of `apps/cli/ai/json-events.ts` we forward to the
// renderer. Update both together.

export type TurnCompletedStatus = 'success' | 'error' | 'paused' | 'max_turns';

export type JsonEvent =
	| { type: 'message'; timestamp: string; message: unknown }
	| {
			type: 'message.delta';
			timestamp: string;
			messageId: string | null;
			event: unknown;
	  }
	| { type: 'progress'; timestamp: string; message: string }
	| { type: 'info'; timestamp: string; message: string }
	| { type: 'error'; timestamp: string; message: string }
	| {
			type: 'question.asked';
			timestamp: string;
			questions: Array< {
				question: string;
				options: Array< { label: string; description: string } >;
			} >;
	  }
	| { type: 'turn.started'; timestamp: string }
	| {
			type: 'turn.completed';
			timestamp: string;
			sessionId: string;
			status: TurnCompletedStatus;
			usage?: { numTurns: number; costUsd?: number };
	  };
