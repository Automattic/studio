import { estimateTokens, generateSummary, shouldCompact } from '@mariozechner/pi-coding-agent';
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import type { Api, Model } from '@mariozechner/pi-ai';

/**
 * Conversation compaction for the unified pi runtime.
 *
 * pi-agent-core ships zero context-window management. Long sessions just keep
 * growing until the model errors with "context too long" — silent failure
 * mode that bites long site-build runs.
 *
 * We hook this via `transformContext`, which pi calls right before each LLM
 * request. The hook estimates the running token count, and when it crosses
 * the threshold (`shouldCompact`), summarizes the older portion into a single
 * message and replaces it.
 *
 * We borrow only the pure helpers from pi-coding-agent (`estimateTokens`,
 * `shouldCompact`, `generateSummary`). Pi's own `findCutPoint` /
 * `prepareCompaction` operate on `SessionEntry[]` (its persisted shape) which
 * we don't use, so we walk our `AgentMessage[]` ourselves — same algorithm,
 * different input type.
 */

export interface CompactionSettings {
	enabled: boolean;
	/**
	 * Tokens reserved for the model's response + system prompt + a safety margin.
	 * `shouldCompact` triggers once running context > contextWindow - reserveTokens.
	 */
	reserveTokens: number;
	/**
	 * How much recent transcript to preserve verbatim past the summary boundary.
	 * Smaller = more aggressive compaction; bigger = preserves more recent detail.
	 */
	keepRecentTokens: number;
}

export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
	enabled: true,
	reserveTokens: 16_384,
	keepRecentTokens: 20_000,
};

export interface BuildTransformContextOptions {
	/**
	 * The active model used for both live agent turns and the compaction
	 * summarizer call. Whatever pi `Model<Api>` the runtime built for the
	 * current dispatch (`anthropic-messages` for Claude, `openai-completions`
	 * for GPT) — `generateSummary` accepts either via pi-coding-agent.
	 */
	model: Model< Api >;
	apiKey: string;
	headers?: Record< string, string >;
	/**
	 * Optional override of the model's contextWindow for the threshold check.
	 * Useful when the upstream proxy enforces a tighter limit than the model
	 * itself. Defaults to `model.contextWindow`.
	 */
	contextWindow?: number;
	/**
	 * Override the default compaction tuning. Production callers leave this
	 * undefined; tests pass tight values to trigger compaction without
	 * generating MB of fixture text.
	 */
	settings?: Partial< CompactionSettings >;
	/**
	 * Optional listener for compaction lifecycle, used by the runtime to
	 * surface progress to the UI ("Compacting conversation history…").
	 */
	onLifecycle?: ( phase: 'start' | 'end' | 'skipped' | 'failed' ) => void;
}

/**
 * Build the `transformContext` callback to hand to pi's `Agent` constructor.
 *
 * Contract from pi: the callback must not throw. We catch summarization
 * errors and fall back to the unmodified messages so the turn still attempts
 * — better to bump up against the real context limit than fail the turn at
 * the compaction step.
 */
export function buildTransformContext( options: BuildTransformContextOptions ) {
	const contextWindow = options.contextWindow ?? options.model.contextWindow;
	const settings: CompactionSettings = {
		...DEFAULT_COMPACTION_SETTINGS,
		...options.settings,
	};

	return async ( messages: AgentMessage[], signal?: AbortSignal ): Promise< AgentMessage[] > => {
		const tokens = estimateTotalTokens( messages );
		if ( ! shouldCompact( tokens, contextWindow, settings ) ) {
			return messages;
		}

		const cutIndex = findTailCutIndex( messages, settings.keepRecentTokens );
		if ( cutIndex <= 0 ) {
			// Either the entire transcript is recent enough that summarizing
			// would lose context, or there's no safe boundary to cut at. Let
			// the turn proceed; the model error (if any) is a louder signal
			// than a silently-truncated transcript.
			options.onLifecycle?.( 'skipped' );
			return messages;
		}

		const toSummarize = messages.slice( 0, cutIndex );
		const kept = messages.slice( cutIndex );

		options.onLifecycle?.( 'start' );
		let summary: string;
		try {
			summary = await generateSummary(
				toSummarize,
				options.model,
				settings.reserveTokens,
				options.apiKey,
				options.headers,
				signal
			);
		} catch {
			options.onLifecycle?.( 'failed' );
			// pi's contract says don't throw from transformContext. Returning
			// the original transcript means the turn proceeds; if the real
			// context window is hit, the model surfaces the error.
			return messages;
		}

		options.onLifecycle?.( 'end' );

		const summaryMessage: AgentMessage = {
			role: 'user',
			// Wrapping the summary in a clearly-marked block is the same pattern
			// pi's own `compactionSummary` custom message uses — the model
			// reads it as system-style context, not a turn to respond to.
			content: `[Earlier conversation summary]\n\n${ summary }`,
			timestamp: Date.now(),
		};

		return [ summaryMessage, ...kept ];
	};
}

function estimateTotalTokens( messages: AgentMessage[] ): number {
	let total = 0;
	for ( const message of messages ) {
		total += estimateTokens( message );
	}
	return total;
}

/**
 * Walk backwards through the transcript, accumulating estimated tokens. Cut
 * at the first user-message boundary we hit *after* exceeding
 * `keepRecentTokens` worth of recent content.
 *
 * Why user-message boundaries: an assistant message with `toolCall` blocks
 * must be followed by the matching `toolResult` messages. Cutting between
 * them would leave the model with a dangling tool result. User messages are
 * always safe — they're the start of a fresh turn.
 *
 * Returns the *index of the user message* to keep first. Everything before
 * that index gets summarized; everything from it onward is preserved
 * verbatim.
 *
 * Returns 0 (no cut) if the entire transcript fits in the keep window or no
 * user-message boundary exists past the threshold.
 */
function findTailCutIndex( messages: AgentMessage[], keepRecentTokens: number ): number {
	let acc = 0;
	for ( let i = messages.length - 1; i >= 0; i-- ) {
		acc += estimateTokens( messages[ i ] );
		if ( messages[ i ].role === 'user' && acc >= keepRecentTokens && i > 0 ) {
			return i;
		}
	}
	return 0;
}
