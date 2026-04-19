import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AskUserQuestion } from 'cli/ai/agent';

export type JsonEventType =
	| 'message'
	| 'progress'
	| 'info'
	| 'error'
	| 'question.asked'
	| 'turn.started'
	| 'turn.completed';

export type TurnCompletedStatus = 'success' | 'error' | 'paused' | 'max_turns';

export type JsonEvent =
	| {
			type: 'message';
			timestamp: string;
			message: SDKMessage;
	  }
	| {
			type: 'progress';
			timestamp: string;
			message: string;
	  }
	| {
			type: 'info';
			timestamp: string;
			message: string;
	  }
	| {
			type: 'error';
			timestamp: string;
			message: string;
	  }
	| {
			type: 'question.asked';
			timestamp: string;
			questions: Array< {
				question: string;
				options: AskUserQuestion[ 'options' ];
			} >;
	  }
	| {
			type: 'turn.started';
			timestamp: string;
	  }
	| {
			type: 'turn.completed';
			timestamp: string;
			sessionId: string;
			status: TurnCompletedStatus;
			usage?: {
				numTurns: number;
				costUsd?: number;
			};
	  };

export function emitEvent( event: JsonEvent ): void {
	process.stdout.write( JSON.stringify( event ) + '\n' );
}
