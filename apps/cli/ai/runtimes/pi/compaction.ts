import { estimateTokens, generateSummary, shouldCompact } from '@mariozechner/pi-coding-agent';
import type { AgentMessage } from '@mariozechner/pi-agent-core';
import type { Model } from '@mariozechner/pi-ai';

// pi-agent-core ships no context-window management; long sessions otherwise
// just grow until the model errors. We hook `transformContext` to summarize
// older turns when the running token count crosses the threshold.

export interface CompactionSettings {
	enabled: boolean;
	// Tokens reserved for response + system prompt + safety margin.
	reserveTokens: number;
	// Recent transcript preserved verbatim past the summary boundary.
	keepRecentTokens: number;
}

export const DEFAULT_COMPACTION_SETTINGS: CompactionSettings = {
	enabled: true,
	reserveTokens: 16_384,
	keepRecentTokens: 20_000,
};

// Floor for how much window must remain for actual prompt content. The
// defaults (16k/20k) are sized for ≥200k windows; on tighter windows we
// scale down so this minimum is preserved.
const MIN_PROMPT_BUDGET_TOKENS = 4_000;

export function resolveCompactionSettings(
	settings: CompactionSettings,
	contextWindow: number
): CompactionSettings {
	const maxReserve = Math.max( 0, contextWindow - MIN_PROMPT_BUDGET_TOKENS );
	const reserveTokens = Math.min( settings.reserveTokens, maxReserve );
	// Keep-recent has to fit alongside reserve and the prompt budget.
	const maxKeepRecent = Math.max( 0, contextWindow - reserveTokens - MIN_PROMPT_BUDGET_TOKENS );
	const keepRecentTokens = Math.min( settings.keepRecentTokens, maxKeepRecent );
	return { ...settings, reserveTokens, keepRecentTokens };
}

export interface BuildTransformContextOptions {
	model: Model< 'openai-completions' > | Model< 'anthropic-messages' >;
	apiKey: string;
	headers?: Record< string, string >;
	// Override `model.contextWindow` when the proxy enforces a tighter limit.
	contextWindow?: number;
	// Tests pass tight values to trigger compaction without MB of fixture text.
	settings?: Partial< CompactionSettings >;
	onLifecycle?: ( phase: 'start' | 'end' | 'skipped' | 'failed' ) => void;
}

// pi requires `transformContext` not to throw — we swallow summarization
// errors and return the original transcript so the turn still attempts.
export function buildTransformContext( options: BuildTransformContextOptions ) {
	const contextWindow = options.contextWindow ?? options.model.contextWindow;
	const settings = resolveCompactionSettings(
		{ ...DEFAULT_COMPACTION_SETTINGS, ...options.settings },
		contextWindow
	);

	return async ( messages: AgentMessage[], signal?: AbortSignal ): Promise< AgentMessage[] > => {
		// Don't cut between a tool_use and its tool_result — defer to a clean
		// turn boundary so the next turn doesn't see a dangling tool_use.
		const last = messages[ messages.length - 1 ];
		if ( last?.role === 'toolResult' ) {
			return messages;
		}

		const tokens = estimateTotalTokens( messages );
		if ( ! shouldCompact( tokens, contextWindow, settings ) ) {
			return messages;
		}

		const cutIndex = findTailCutIndex( messages, settings.keepRecentTokens );
		if ( cutIndex <= 0 ) {
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
			return messages;
		}

		options.onLifecycle?.( 'end' );

		const summaryMessage: AgentMessage = {
			role: 'user',
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

// Cut at user-message boundaries only — splitting an assistant tool_use
// from its tool_result leaves the next turn with a dangling reference.
// Returns 0 when no safe boundary exists past the keep threshold.
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
