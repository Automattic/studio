import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';

export interface TokenUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
}

export function createTokenUsage(): TokenUsage {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
}

function add( total: TokenUsage, usage: TokenUsage ) {
	total.input += usage.input;
	total.output += usage.output;
	total.cacheRead += usage.cacheRead;
	total.cacheWrite += usage.cacheWrite;
	total.totalTokens += usage.totalTokens;
}

/**
 * Adds what a finished tool call spent on models of its own, as a subagent
 * does (its result's `details.usage`), to `total`.
 */
export function addToolCallUsage( total: TokenUsage, event: AgentSessionEvent ): void {
	const usage =
		event.type === 'tool_execution_end'
			? ( event.result as { details?: { usage?: TokenUsage } } | undefined )?.details?.usage
			: undefined;
	if ( usage ) {
		add( total, usage );
	}
}

/**
 * Adds an assistant `message_end`'s usage to `total` and returns that usage, or
 * `undefined` for any other event (or an assistant message with no usage).
 */
export function addAssistantMessageUsage(
	total: TokenUsage,
	event: AgentSessionEvent
): TokenUsage | undefined {
	if ( event.type !== 'message_end' || event.message.role !== 'assistant' ) {
		return undefined;
	}
	const messageUsage = event.message.usage;
	if ( ! messageUsage ) {
		return undefined;
	}
	add( total, messageUsage );
	return messageUsage;
}
