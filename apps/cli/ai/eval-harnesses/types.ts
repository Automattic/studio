import type { SiteInfo } from '@studio/agent/node';
import type { StopRule } from 'cli/ai/eval-stop';
import type { ModelRequestRecord } from 'cli/ai/eval-timing';

export interface HarnessInput {
	harness?: string;
	ui?: boolean;
	prompt: string;
	followUps?: Array< { prompt: string } >;
	answers?: Array< { label: string } >;
	timeoutMs?: number;
	model?: string;
	stopAt?: StopRule[];
}

export interface HarnessContext {
	startedAt: number;
	// The case seeded made-up remote-site connections, which the user's real account doesn't have.
	seededRemoteSites?: boolean;
	activeSite?: SiteInfo;
	cwd: string;
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
	phaseTimingsMs: Record< string, number >;
	unsupported?: string[];
}

export interface EvalHarness {
	id: string;
	runConversation: ( input: HarnessInput, ctx: HarnessContext ) => Promise< HarnessTranscript >;
}
