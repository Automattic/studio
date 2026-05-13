/**
 * Adapter that maps MCP `CallToolResult.content[]` blocks down to the
 * narrower pi-agent-core `AgentToolResult.content[]` shape.
 *
 * MCP defines five content variants — `text`, `image`, `audio`, `resource`,
 * and `resource_link` — whereas pi only consumes `text` and `image`. The
 * adapter:
 *
 * - passes `text` and `image` through unchanged
 * - flattens an inline `resource` (text variant) into a labelled `text` block
 * - serialises a `resource_link` to a `text` block describing the link
 * - drops `audio` (and any unknown future types) with a `console.warn`
 *
 * Per wave-1-mcp-bridge-feasibility §2, DLA's MCP server emits text-only
 * payloads today, so the non-text branches exist purely for forward
 * compatibility with other MCP servers that may be wrapped through this
 * package in the future.
 */
import type { ImageContent, TextContent } from '@mariozechner/pi-ai';

/**
 * The subset of the MCP `ContentBlock` discriminated union that the bridge
 * needs to inspect. Typed structurally to avoid pulling MCP's deeply nested
 * `Zod`-derived runtime types into consumers.
 */
export interface McpTextBlock {
	type: 'text';
	text: string;
}

/**
 * MCP image block: base64-encoded payload + mime type.
 */
export interface McpImageBlock {
	type: 'image';
	data: string;
	mimeType: string;
}

/**
 * MCP audio block. Dropped by the adapter — pi cannot render audio inline
 * and the bridged DLA tools never emit this variant.
 */
export interface McpAudioBlock {
	type: 'audio';
	data: string;
	mimeType: string;
}

/**
 * MCP embedded-resource block. Two variants exist on the wire: a text
 * resource (`resource.text`) and a binary resource (`resource.blob`).
 * Only the text variant is flattened; the binary variant is dropped.
 */
export interface McpResourceBlock {
	type: 'resource';
	resource:
		| { uri: string; text: string; mimeType?: string }
		| { uri: string; blob: string; mimeType?: string };
}

/**
 * MCP resource-link block. The adapter serialises it to a `text` block
 * so the model receives a human-readable reference to the linked
 * resource.
 */
export interface McpResourceLinkBlock {
	type: 'resource_link';
	uri: string;
	name?: string;
	description?: string;
	mimeType?: string;
}

/**
 * Union of MCP content blocks the adapter accepts as input.
 */
export type McpContentBlock =
	| McpTextBlock
	| McpImageBlock
	| McpAudioBlock
	| McpResourceBlock
	| McpResourceLinkBlock
	| { type: string; [ key: string ]: unknown };

/**
 * Maps a single MCP content block to zero or more pi content blocks.
 *
 * @param block - The MCP content block to adapt.
 * @returns An array of pi content blocks. Empty if the block is dropped.
 *
 * @example
 * adaptMcpContentBlock({ type: 'text', text: 'hello' })
 * // -> [{ type: 'text', text: 'hello' }]
 */
export function adaptMcpContentBlock( block: McpContentBlock ): ( TextContent | ImageContent )[] {
	switch ( block.type ) {
		case 'text': {
			const text = ( block as McpTextBlock ).text;
			return [ { type: 'text', text } ];
		}
		case 'image': {
			const { data, mimeType } = block as McpImageBlock;
			return [ { type: 'image', data, mimeType } ];
		}
		case 'resource': {
			const { resource } = block as McpResourceBlock;
			if ( 'text' in resource && typeof resource.text === 'string' ) {
				return [
					{
						type: 'text',
						text: `[resource ${ resource.uri }]\n${ resource.text }`,
					},
				];
			}
			// Binary resource — surface a stub pointer; the model can ask the
			// server to refetch via a more specific tool call if it needs the
			// payload.
			return [
				{
					type: 'text',
					text: `[resource ${ resource.uri } (binary, ${
						resource.mimeType ?? 'unknown mime type'
					})]`,
				},
			];
		}
		case 'resource_link': {
			const link = block as McpResourceLinkBlock;
			const suffix = link.description ? ` — ${ link.description }` : '';
			return [
				{
					type: 'text',
					text: `[resource_link ${ link.uri }${ suffix }]`,
				},
			];
		}
		case 'audio': {
			console.warn( '[@studio/dla] dropping unsupported MCP audio content block' );
			return [];
		}
		default: {
			console.warn(
				`[@studio/dla] dropping unknown MCP content block of type "${ String( block.type ) }"`
			);
			return [];
		}
	}
}

/**
 * Maps the full `content[]` array of an MCP `CallToolResult` to pi's
 * narrower `(TextContent | ImageContent)[]` shape.
 *
 * @param blocks - The MCP content blocks emitted by the remote tool.
 * @returns The pi-compatible content array, flattened across adaptations.
 *
 * @example
 * adaptMcpContent([
 *   { type: 'text', text: 'a' },
 *   { type: 'audio', data: '...', mimeType: 'audio/wav' },
 * ])
 * // -> [{ type: 'text', text: 'a' }]
 */
export function adaptMcpContent( blocks: McpContentBlock[] ): ( TextContent | ImageContent )[] {
	return blocks.flatMap( adaptMcpContentBlock );
}
