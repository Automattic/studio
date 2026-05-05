/**
 * Minimal structural types + guards for the streaming-message format that
 * both the CLI and the UI care about. The CLI narrows further against its
 * full local types in `cli/ai/runtimes/messages`; the UI only needs these
 * structural shapes.
 *
 * Kept free of any runtime dependency so this module can live in
 * `tools/common` without forcing the CLI's runtime types on every consumer.
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
