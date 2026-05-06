// Thin shim around pi-coding-agent's compaction primitives, since
// `prepareCompaction` and `estimateContextTokens` aren't exported in
// 0.70.2. We walk the session entries with the public `findCutPoint`,
// summarize via `generateSummary`, and persist via
// `sessionManager.appendCompaction` — the same path AgentSession takes
// internally. Going through AgentSession itself would clobber our
// system prompt every turn, which is why this lives here.

import { isContextOverflow, type AssistantMessage, type Model } from '@mariozechner/pi-ai';
import {
	calculateContextTokens,
	findCutPoint,
	generateSummary,
	type CompactionResult,
	type CompactionSettings,
	type SessionManager,
} from '@mariozechner/pi-coding-agent';
import type { Agent, AgentMessage } from '@mariozechner/pi-agent-core';

export type StudioModel = Model< 'openai-completions' > | Model< 'anthropic-messages' >;

export type CompactionReason = 'threshold' | 'overflow';

// Sized for ≥200k windows; pi clamps both fields against the actual
// `model.contextWindow` inside `findCutPoint`.
export const STUDIO_COMPACTION_SETTINGS: CompactionSettings = {
	enabled: true,
	reserveTokens: 16_384,
	keepRecentTokens: 20_000,
};

// Decide whether the just-finished assistant turn should trigger
// compaction. Returns the reason or `null`.
export function shouldCompact(
	msg: AssistantMessage,
	model: StudioModel,
	settings: CompactionSettings
): CompactionReason | null {
	if ( ! settings.enabled || msg.stopReason === 'aborted' ) return null;
	if ( isContextOverflow( msg, model.contextWindow ) ) return 'overflow';
	if ( msg.stopReason === 'error' ) return null;
	const reserve = settings.reserveTokens ?? 0;
	const usable = Math.max( 0, model.contextWindow - reserve );
	return calculateContextTokens( msg.usage ) >= usable ? 'threshold' : null;
}

export interface RunCompactionArgs {
	agent: Agent;
	sessionManager: SessionManager;
	model: StudioModel;
	apiKey: string;
	headers?: Record< string, string >;
	settings: CompactionSettings;
	signal: AbortSignal;
	tokensBefore: number;
}

// Persists a `CompactionEntry`, then rewrites `agent.state.messages`
// from the post-compaction `buildSessionContext()` so the next request
// ships the trimmed transcript. Returns `undefined` when there's
// nothing to compact (no entries, an existing compaction at the leaf,
// or no clean cut point past the keep-recent budget).
export async function runCompaction(
	args: RunCompactionArgs
): Promise< CompactionResult | undefined > {
	const { sessionManager, agent, model, apiKey, headers, settings, signal, tokensBefore } = args;
	const entries = sessionManager.getBranch();
	if ( entries.length === 0 || entries[ entries.length - 1 ].type === 'compaction' ) {
		return undefined;
	}

	// Anything before the previous compaction is already summarized.
	let boundaryStart = 0;
	let previousSummary: string | undefined;
	for ( let i = entries.length - 1; i >= 0; i -= 1 ) {
		const entry = entries[ i ];
		if ( entry.type === 'compaction' ) {
			const idx = entries.findIndex( ( e ) => e.id === entry.firstKeptEntryId );
			boundaryStart = idx >= 0 ? idx : i + 1;
			previousSummary = entry.summary;
			break;
		}
	}

	const cut = findCutPoint(
		entries,
		boundaryStart,
		entries.length,
		settings.keepRecentTokens ?? 0
	);
	// Round mid-turn cuts up to the turn start — pi splits them with a
	// prefix-summary helper that isn't exported. Worst case: one extra
	// turn stays verbatim.
	const keptIndex =
		cut.isSplitTurn && cut.turnStartIndex >= boundaryStart
			? cut.turnStartIndex
			: cut.firstKeptEntryIndex;
	if ( keptIndex <= boundaryStart ) return undefined;

	const firstKept = entries[ keptIndex ];
	if ( ! firstKept?.id ) return undefined;

	const messages: AgentMessage[] = [];
	for ( let i = boundaryStart; i < keptIndex; i += 1 ) {
		const entry = entries[ i ];
		if ( entry.type === 'message' ) {
			messages.push( entry.message );
		} else if ( entry.type === 'custom_message' ) {
			// `buildSessionContext` materializes these as user messages.
			messages.push( {
				role: 'user',
				content: entry.content,
				timestamp: new Date( entry.timestamp ).getTime(),
			} );
		}
	}
	if ( messages.length === 0 ) return undefined;

	const summary = await generateSummary(
		messages,
		model,
		settings.reserveTokens ?? 0,
		apiKey,
		headers,
		signal,
		undefined,
		previousSummary,
		agent.state.thinkingLevel
	);

	sessionManager.appendCompaction( summary, firstKept.id, tokensBefore, undefined, false );
	agent.state.messages = sessionManager.buildSessionContext().messages;

	return { summary, firstKeptEntryId: firstKept.id, tokensBefore };
}
