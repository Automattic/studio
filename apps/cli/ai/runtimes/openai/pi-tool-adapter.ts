import { Type, type TSchema } from 'typebox';
import { z } from 'zod/v4';
import type { SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk';
import type { AgentTool } from '@mariozechner/pi-agent-core';

/**
 * Flatten a Claude-Agent-SDK tool result (content blocks) to the pi-agent-core
 * result shape. pi-ai's `TextContent` / `ImageContent` are structurally identical
 * to the Anthropic SDK's text/image blocks, so the translation is essentially
 * a pass-through with defensive fallbacks for non-standard shapes.
 */
function convertContent(
	content: unknown
): Array< { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string } > {
	if ( ! Array.isArray( content ) ) {
		return [
			{ type: 'text', text: typeof content === 'string' ? content : JSON.stringify( content ) },
		];
	}
	return content.map( ( part ) => {
		if ( ! part || typeof part !== 'object' ) {
			return { type: 'text' as const, text: String( part ) };
		}
		const p = part as { type?: string; text?: string; data?: string; mimeType?: string };
		if ( p.type === 'image' && typeof p.data === 'string' && typeof p.mimeType === 'string' ) {
			return { type: 'image' as const, data: p.data, mimeType: p.mimeType };
		}
		return {
			type: 'text' as const,
			text: typeof p.text === 'string' ? p.text : JSON.stringify( part ),
		};
	} );
}

/**
 * Adapts a Claude-Agent-SDK tool definition (zod-shaped `inputSchema`) to a
 * pi-agent-core `AgentTool` (typebox-shaped `parameters`).
 *
 * The conversion route is `zod → JSON Schema → typebox Unsafe<T>`. typebox's
 * `Type.Unsafe` wraps a raw JSON Schema with a `TSchema` brand without
 * introspecting it, which matches what pi-ai actually needs — the provider
 * serializes the schema as tool-call metadata for the LLM, and params come
 * back as plain JSON that pi-agent-core forwards to `execute` without
 * additional validation. zod's own runtime validation is preserved inside our
 * tool handlers where it matters.
 */
export function adaptToolsForPi(
	definitions: readonly SdkMcpToolDefinition[]
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
): AgentTool< any >[] {
	return definitions.map( ( def ) => {
		const zodObject = z.object( def.inputSchema );
		const jsonSchema = z.toJSONSchema( zodObject ) as Record< string, unknown >;
		const parameters = Type.Unsafe< unknown >( jsonSchema ) as TSchema;

		return {
			name: def.name,
			description: def.description,
			parameters,
			label: def.name,
			execute: async ( _toolCallId, params ) => {
				try {
					const result = await def.handler( params as never, null );
					const content = convertContent( ( result as { content?: unknown } ).content );
					if ( ( result as { isError?: boolean } ).isError ) {
						const textPart = content.find( ( c ) => c.type === 'text' );
						throw new Error(
							textPart && 'text' in textPart ? textPart.text : 'Tool reported an error'
						);
					}
					return { content, details: undefined };
				} catch ( error ) {
					// pi's agent loop treats thrown errors as failed tool calls and
					// synthesizes an error tool-result automatically.
					if ( error instanceof Error ) throw error;
					throw new Error( String( error ) );
				}
			},
		};
	} );
}
