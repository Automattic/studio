/**
 * Minimal structural types + guards for the synthetic SDKMessage shapes the
 * CLI's pi runtime emits. Both the CLI and the desktop UI consume these
 * shapes; this module is the shared structural contract.
 *
 * Pre-pi-migration the CLI narrowed further against the full
 * `@anthropic-ai/claude-agent-sdk` types. After the unification, the runtime
 * synthesizes the exact same JSON shape (see `apps/cli/ai/runtimes/pi`) but
 * no SDK dependency is involved at compile or runtime.
 */

export interface TextBlock {
	type: 'text';
	text: string;
}

export interface ToolUseBlock {
	type: 'tool_use';
	id: string;
	name: string;
	input?: Record< string, unknown >;
}

export type AssistantContentBlock = TextBlock | ToolUseBlock | { type: string };

export interface AssistantSdkMessage {
	type: 'assistant';
	message: { content: AssistantContentBlock[] };
}

export function isAssistantSdkMessage( value: unknown ): value is AssistantSdkMessage {
	if ( ! value || typeof value !== 'object' ) {
		return false;
	}
	const outer = value as { type?: unknown; message?: unknown };
	if ( outer.type !== 'assistant' ) {
		return false;
	}
	const inner = outer.message as { content?: unknown } | undefined;
	return !! inner && Array.isArray( inner.content );
}

export function isTextBlock( block: AssistantContentBlock ): block is TextBlock {
	return block.type === 'text' && typeof ( block as TextBlock ).text === 'string';
}

export function isToolUseBlock( block: AssistantContentBlock ): block is ToolUseBlock {
	return block.type === 'tool_use';
}
