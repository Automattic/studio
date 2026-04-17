// Event types matching the JSON mode output from `studio code --json`
// See: apps/cli/ai/json-events.ts

export type TurnCompletedStatus = 'success' | 'error' | 'paused' | 'max_turns';

export interface TurnUsage {
	numTurns: number;
	costUsd?: number;
}

export interface QuestionOption {
	label: string;
	description?: string;
}

export interface QuestionEntry {
	question: string;
	options: QuestionOption[];
}

export type StudioCodeEvent =
	| { type: 'message'; timestamp: string; message: unknown }
	| { type: 'progress'; timestamp: string; message: string }
	| { type: 'info'; timestamp: string; message: string }
	| { type: 'error'; timestamp: string; message: string }
	| { type: 'question.asked'; timestamp: string; questions: QuestionEntry[] }
	| { type: 'turn.started'; timestamp: string }
	| {
			type: 'turn.completed';
			timestamp: string;
			sessionId: string;
			status: TurnCompletedStatus;
			usage?: TurnUsage;
	  };
