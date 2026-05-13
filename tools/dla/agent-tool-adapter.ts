/**
 * Wraps a remote MCP tool descriptor as a pi-coding-agent
 * `ToolDefinition` that the Studio CLI runtime can register through its
 * `customTools` slot.
 *
 * The adapter is structurally identical to the inverse direction at
 * `apps/cli/ai/mcp-server.ts`: where that file casts pi tools into MCP
 * shape, this file casts MCP tools into pi shape. Both rely on the fact
 * that pi-ai's `validateToolArguments` accepts plain JSON Schema objects
 * — no TypeBox metadata is required at runtime — so the
 * `inputSchema as unknown as TSchema` cast is safe.
 *
 * See `issues/rsm-3143-dla-pi-research/wave-1-findings/wave-1-mcp-bridge-feasibility.md`
 * §2 for the full evidence trail.
 */
import { adaptMcpContent, type McpContentBlock } from './content-adapter';
import { defaultPolicyBuckets, shouldBlock, type DlaPolicyBuckets } from './policy';
import type { AgentToolResult } from '@mariozechner/pi-agent-core';
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { TSchema } from 'typebox';

/**
 * The subset of an MCP `Tool` descriptor returned by `client.listTools()`
 * that the adapter consumes. Typed structurally to keep the bridge
 * decoupled from the SDK's deeply nested Zod-derived types.
 */
export interface RemoteMcpTool {
	/** The MCP tool name (`liberate_detect`, `liberate_inspect`, ...). */
	name: string;
	/** Optional human-readable description forwarded to the model. */
	description?: string;
	/** JSON Schema for the tool's arguments. Forwarded to pi as-is. */
	inputSchema: {
		type: 'object';
		properties?: Record< string, unknown >;
		required?: string[];
		[ key: string ]: unknown;
	};
}

/**
 * Options for `adaptMcpToolToPi`. The adapter accepts a policy getter so
 * that the runtime can swap buckets at session boundaries without having
 * to rebuild every adapted tool definition.
 */
export interface AdaptMcpToolOptions {
	/** Resolved buckets for the current session. */
	getBuckets?: () => DlaPolicyBuckets;
}

/**
 * Build a Studio-compatible error class that callers can identify via
 * `error instanceof DlaPolicyError` while pi treats it as a regular
 * `Error` (caught by `executePreparedToolCall` and surfaced as
 * `isError: true` in the model transcript).
 */
export class DlaPolicyError extends Error {
	constructor( message: string ) {
		super( message );
		this.name = 'DlaPolicyError';
	}
}

/**
 * Wrap a single remote MCP tool as a pi `ToolDefinition`.
 *
 * On invocation the wrapper:
 *
 * 1. Consults the policy via `shouldBlock`. A blocking verdict throws a
 *    `DlaPolicyError`; pi catches it and surfaces the reason as the
 *    tool-call error.
 * 2. Forwards the call to `client.callTool` with the pi-supplied
 *    `AbortSignal` plumbed through `RequestOptions.signal`. The MCP SDK
 *    sends `notifications/cancelled` on abort (verified at
 *    `node_modules/@modelcontextprotocol/sdk/dist/esm/shared/protocol.js`
 *    lines 677, 709-710).
 * 3. Adapts the returned `CallToolResult.content[]` to pi's narrower
 *    shape via `adaptMcpContent`, and surfaces `structuredContent` as
 *    `AgentToolResult.details`.
 * 4. Detects `result.isError === true` and rethrows with the first text
 *    block as the error message — matches the contract
 *    `executePreparedToolCall` expects.
 *
 * @param remoteTool - The MCP tool descriptor (from `listTools`).
 * @param client - The connected MCP client used to forward calls.
 * @param options - Optional policy hooks.
 * @returns A `ToolDefinition` ready to be passed to pi via `customTools`.
 *
 * @example
 * const tools = listed.tools.map( ( t ) =>
 *   adaptMcpToolToPi( t, client, { getBuckets: () => buckets } )
 * );
 */
export function adaptMcpToolToPi(
	remoteTool: RemoteMcpTool,
	client: Pick< Client, 'callTool' >,
	options: AdaptMcpToolOptions = {}
): ToolDefinition {
	const getBuckets = options.getBuckets ?? ( () => defaultPolicyBuckets );

	// Schema cast: MCP tools ship plain JSON Schema; pi-ai's
	// `validateToolArguments` accepts plain JSON Schema (see
	// wave-1-mcp-bridge-feasibility.md §2). Same idiom Studio's MCP
	// *server* uses in the inverse direction at
	// `apps/cli/ai/mcp-server.ts:27`.

	const parameters = remoteTool.inputSchema as unknown as TSchema;

	return {
		name: remoteTool.name,
		label: remoteTool.name,
		description: remoteTool.description ?? '',
		parameters,
		async execute(
			_toolCallId,
			params,
			signal
		): Promise< AgentToolResult< Record< string, unknown > | undefined > > {
			const decision = shouldBlock( remoteTool.name, params, getBuckets() );
			if ( decision.block ) {
				throw new DlaPolicyError(
					decision.reason ?? `Studio policy blocked tool call "${ remoteTool.name }"`
				);
			}

			const result = await client.callTool(
				{
					name: remoteTool.name,
					arguments: ( params ?? {} ) as Record< string, unknown >,
				},
				undefined,
				{ signal }
			);

			const contentBlocks = ( result.content ?? [] ) as McpContentBlock[];
			if ( result.isError ) {
				const firstText = contentBlocks.find(
					( block ): block is { type: 'text'; text: string } =>
						block.type === 'text' && typeof ( block as { text?: unknown } ).text === 'string'
				);
				const message =
					firstText?.text ??
					`Remote DLA tool "${ remoteTool.name }" reported an error without a text payload.`;
				throw new Error( message );
			}

			return {
				content: adaptMcpContent( contentBlocks ),
				details: result.structuredContent as Record< string, unknown > | undefined,
			};
		},
	};
}
