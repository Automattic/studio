// Adapter that runs pi-coding-agent's compaction primitives against our
// `Agent` + `SessionManager` pair, without going through `AgentSession`
// (which would also overwrite the system prompt every turn).
//
// Mirrors AgentSession's `_checkCompaction` + `_runAutoCompaction` using
// only the public pi exports. Pi 0.70.2 ships `prepareCompaction` and
// `estimateContextTokens` as internal-only helpers, so we walk session
// entries ourselves with `findCutPoint` (exported), extract the messages
// to summarize, and call `generateSummary` directly.
//
// What we get vs. AgentSession:
// - Same trigger semantics (`shouldCompact` against real LLM `usage`,
//   `isContextOverflow` for hard failures)
// - Same persistence (`sessionManager.appendCompaction` writes a real
//   `CompactionEntry`; next turn rebuilds via `buildSessionContext`)
// - Same event shape (`AgentSessionEvent` `compaction_start` /
//   `compaction_end`)
// - Same overflow recovery surface (caller handles `agent.continue()`)
//
// What we lose vs. AgentSession:
// - File-operations tracking in the summary tail (`extractFileOperations`
//   is internal-only; pi normally appends "Read files: …, Modified files: …")
// - True split-turn handling — pi summarizes the prefix of a half-cut
//   turn and merges it with the older history summary. We round the cut
//   up to the next clean turn boundary instead, so at most one extra
//   turn stays verbatim. No correctness issue, just a slightly less
//   aggressive trim.

import { isContextOverflow, type AssistantMessage, type Model } from '@mariozechner/pi-ai';
import {
	calculateContextTokens,
	findCutPoint,
	generateSummary,
	getLatestCompactionEntry,
	type CompactionResult,
	type CompactionSettings,
	type SessionEntry,
	type SessionManager,
} from '@mariozechner/pi-coding-agent';
import type { Agent, AgentMessage } from '@mariozechner/pi-agent-core';

export type CompactionReason = 'manual' | 'threshold' | 'overflow';

// Tokens reserved for response + system prompt + safety margin, plus how
// much recent transcript to preserve verbatim past the summary boundary.
// Sized for ≥200k windows.
export const STUDIO_COMPACTION_SETTINGS: CompactionSettings = {
	enabled: true,
	reserveTokens: 16_384,
	keepRecentTokens: 20_000,
};

interface DecideCompactionArgs {
	assistantMessage: AssistantMessage;
	agent: Agent;
	sessionManager: SessionManager;
	model: Model< 'openai-completions' > | Model< 'anthropic-messages' >;
	settings: CompactionSettings;
	overflowRecoveryAttempted: boolean;
	// True when called as a pre-flight check from the prompt path; pi's
	// AgentSession passes `false` here because users actively want to send
	// a follow-up even on an aborted prior turn.
	skipAbortedCheck: boolean;
}

export type CompactionDecision =
	| { kind: 'none' }
	| { kind: 'overflow' }
	| { kind: 'threshold' }
	| { kind: 'overflow_already_attempted'; errorMessage: string };

// Mirrors AgentSession._checkCompaction with the public token helpers.
export function decideCompaction( args: DecideCompactionArgs ): CompactionDecision {
	const { assistantMessage, sessionManager, model, settings, skipAbortedCheck } = args;

	if ( ! settings.enabled ) return { kind: 'none' };

	if ( skipAbortedCheck && assistantMessage.stopReason === 'aborted' ) {
		return { kind: 'none' };
	}

	const contextWindow = model.contextWindow ?? 0;

	// Don't trigger off a stale message recorded before the most recent
	// compaction — its usage reflects the old (larger) context.
	const compactionEntry = getLatestCompactionEntry( sessionManager.getBranch() );
	const fromBeforeCompaction =
		compactionEntry !== null &&
		assistantMessage.timestamp <= new Date( compactionEntry.timestamp ).getTime();
	if ( fromBeforeCompaction ) return { kind: 'none' };

	// Overflow check is model-scoped: a smaller-context model's overflow
	// shouldn't trigger compaction after the user swaps to a larger one.
	const sameModel =
		assistantMessage.provider === model.provider && assistantMessage.model === model.id;

	if ( sameModel && isContextOverflow( assistantMessage, contextWindow ) ) {
		if ( args.overflowRecoveryAttempted ) {
			return {
				kind: 'overflow_already_attempted',
				errorMessage:
					'Context overflow recovery failed after one compact-and-retry attempt. Try reducing context or switching to a larger-context model.',
			};
		}
		return { kind: 'overflow' };
	}

	// Threshold uses the LLM's reported usage (accurate). Error responses
	// don't carry usage, so we can't threshold-compact off them — pi's
	// internal `estimateContextTokens` fallback isn't exported, and our
	// own per-message estimator would diverge from pi's accounting.
	if ( assistantMessage.stopReason === 'error' ) return { kind: 'none' };

	const contextTokens = calculateContextTokens( assistantMessage.usage );
	const reserveTokens = settings.reserveTokens ?? 0;
	const usableWindow = Math.max( 0, contextWindow - reserveTokens );
	if ( contextTokens >= usableWindow ) {
		return { kind: 'threshold' };
	}
	return { kind: 'none' };
}

export interface RunCompactionArgs {
	agent: Agent;
	sessionManager: SessionManager;
	model: Model< 'openai-completions' > | Model< 'anthropic-messages' >;
	apiKey: string;
	headers?: Record< string, string >;
	settings: CompactionSettings;
	signal: AbortSignal;
	tokensBefore: number;
}

// Persists a compaction entry, rewrites `agent.state.messages` from the
// post-compaction session context, and returns the result. Caller emits
// `compaction_start` / `compaction_end` around this and handles the
// overflow retry via `agent.continue()`.
//
// Returns `undefined` when there's nothing to compact (no entries, an
// existing compaction at the leaf, or no clean cut point that respects
// `keepRecentTokens`).
export async function runCompaction(
	args: RunCompactionArgs
): Promise< CompactionResult | undefined > {
	const { sessionManager, agent, model, apiKey, headers, settings, signal, tokensBefore } = args;
	const pathEntries = sessionManager.getBranch();
	if ( pathEntries.length === 0 ) return undefined;
	if ( pathEntries[ pathEntries.length - 1 ].type === 'compaction' ) return undefined;

	const { boundaryStart, previousSummary } = resolvePreviousCompaction( pathEntries );

	const cutPoint = findCutPoint(
		pathEntries,
		boundaryStart,
		pathEntries.length,
		settings.keepRecentTokens ?? 0
	);

	// `findCutPoint` returns `firstKeptEntryIndex === boundaryStart` when
	// nothing past the keep budget can be discarded.
	if ( cutPoint.firstKeptEntryIndex <= boundaryStart ) return undefined;

	// Mid-turn cuts: pi would split the turn and generate a prefix summary,
	// but the helpers it uses for that aren't exported. Round the cut up to
	// the start of the affected turn so the kept tail is always a clean
	// turn boundary. Worst case: one extra turn keeps its full transcript.
	const keptIndex =
		cutPoint.isSplitTurn && cutPoint.turnStartIndex >= boundaryStart
			? cutPoint.turnStartIndex
			: cutPoint.firstKeptEntryIndex;
	if ( keptIndex <= boundaryStart ) return undefined;

	const firstKeptEntry = pathEntries[ keptIndex ];
	if ( ! firstKeptEntry?.id ) return undefined;

	const messagesToSummarize = collectMessagesForSummary( pathEntries, boundaryStart, keptIndex );
	if ( messagesToSummarize.length === 0 ) return undefined;

	const reserveTokens = settings.reserveTokens ?? 0;
	const summary = await generateSummary(
		messagesToSummarize,
		model,
		reserveTokens,
		apiKey,
		headers,
		signal,
		undefined,
		previousSummary,
		agent.state.thinkingLevel
	);

	sessionManager.appendCompaction( summary, firstKeptEntry.id, tokensBefore, undefined, false );

	// Rebuild the in-memory transcript so the next agent.continue() / prompt()
	// sees the trimmed context. Without this, the next request still ships
	// the pre-compaction messages even though the JSONL has the summary.
	agent.state.messages = sessionManager.buildSessionContext().messages;

	return {
		summary,
		firstKeptEntryId: firstKeptEntry.id,
		tokensBefore,
	};
}

// Walk back from the leaf to find the most recent compaction. Anything
// before it is already summarized — only entries from `firstKeptEntryId`
// onward are eligible for the next round of summarization.
function resolvePreviousCompaction( pathEntries: SessionEntry[] ): {
	boundaryStart: number;
	previousSummary?: string;
} {
	for ( let i = pathEntries.length - 1; i >= 0; i -= 1 ) {
		const entry = pathEntries[ i ];
		if ( entry.type === 'compaction' ) {
			const firstKeptIndex = pathEntries.findIndex( ( e ) => e.id === entry.firstKeptEntryId );
			return {
				boundaryStart: firstKeptIndex >= 0 ? firstKeptIndex : i + 1,
				previousSummary: entry.summary,
			};
		}
	}
	return { boundaryStart: 0 };
}

function collectMessagesForSummary(
	entries: SessionEntry[],
	startIndex: number,
	endIndex: number
): AgentMessage[] {
	const messages: AgentMessage[] = [];
	for ( let i = startIndex; i < endIndex; i += 1 ) {
		const entry = entries[ i ];
		if ( entry.type === 'message' ) {
			messages.push( entry.message );
		} else if ( entry.type === 'custom_message' ) {
			// `buildSessionContext` materializes `custom_message` entries as
			// user messages — match that for the summary input so the
			// generated summary doesn't drop extension-injected context.
			messages.push( {
				role: 'user',
				content: entry.content,
				timestamp: new Date( entry.timestamp ).getTime(),
			} );
		}
	}
	return messages;
}
