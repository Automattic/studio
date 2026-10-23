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
	total.input += messageUsage.input;
	total.output += messageUsage.output;
	total.cacheRead += messageUsage.cacheRead;
	total.cacheWrite += messageUsage.cacheWrite;
	total.totalTokens += messageUsage.totalTokens;
	return messageUsage;
}
