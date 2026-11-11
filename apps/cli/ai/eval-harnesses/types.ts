import type { SiteInfo } from '@studio/agent/node';
import type { EvalAnswers } from 'cli/ai/eval-answers';
import type { SiteFingerprint } from 'cli/ai/eval-outcome';
import type { StopRule } from 'cli/ai/eval-stop';
import type { ModelRequestRecord } from 'cli/ai/eval-timing';

export interface HarnessInput {
	harness?: string;
	ui?: boolean;
	prompt: string;
	followUps?: Array< { prompt: string } >;
	answers?: EvalAnswers;
	timeoutMs?: number;
	model?: string;
	stopAt?: StopRule[];
}

export interface HarnessContext {
	startedAt: number;
	activeSite?: SiteInfo;
	cwd: string;
	// The sites before the conversation, to tell what it changes.
	sitesBeforeTurn: SiteFingerprint[];
}

export interface HarnessTranscript {
	success: boolean;
	error: string | null;
	timedOut: boolean;
	model: string | undefined;
	numTurns: number | null;
	stopReason: string | null;
	errorMessage: string | null;
	stoppedAt: { toolUseId: string; toolName: string; index: number } | null;
	usage: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		totalTokens: number;
	};
	sessionFile: string | null;
	requests: ModelRequestRecord[];
	turnDurationsMs: number[];
	toolCalls: Array< { id: string; name: string; input: unknown } >;
	toolResults: Array< {
		toolUseId: string | null;
		toolName: string | null;
		isError: boolean;
		text?: string;
		images?: Array< { mimeType: string; data: string } >;
		details?: unknown;
	} >;
	toolEvents: Array< {
		toolUseId: string;
		toolName: string;
		input: unknown;
		startedAtMs: number;
		endedAtMs?: number;
		durationMs?: number;
		// Studio's checks around the tool's run, within durationMs.
		checksMs?: number;
		checkStagesMs?: Record< string, number >;
		// The longest read or check of each site change source since the last call took them.
		checkSourcesMs?: Record< string, number >;
		// The model requests a call made of its own, as a subagent's turn does.
		modelRequests?: number;
		isError?: boolean;
		outputChars?: number;
		turnIndex: number;
	} >;
	firstToolError: {
		toolUseId: string | null;
		toolName: string | null;
		input?: unknown;
		error: string;
		turnIndex: number;
	} | null;
	textSegments: string[];
	questions: Array< { question: string; options: string[]; answer: string } >;
	// Each turn's system prompt, so a result shows the facts the agent was given.
	systemPrompts?: string[];
	// Each created site's home page styles after every turn but the last.
	homeStylesByTurn?: Array< Record< string, unknown > >;
	phaseTimingsMs: Record< string, number >;
	unsupported?: string[];
}

export interface EvalHarness {
	id: string;
	runConversation: ( input: HarnessInput, ctx: HarnessContext ) => Promise< HarnessTranscript >;
}
