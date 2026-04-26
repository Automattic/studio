/**
 * Local mirror of the Claude Agent SDK message shapes the rest of the codebase
 * consumes. The unified pi runtime synthesizes these shapes; the desktop UI's
 * recorder + JSONL contract reads them back. Keeping the contract here means
 * we can drop the `@anthropic-ai/claude-agent-sdk` dependency without forcing
 * structural changes through the recorder, the UI, or `tools/common`.
 *
 * The shapes are intentionally permissive (`unknown`/`Record<string, unknown>`)
 * — the UI narrows what it actually reads, and the recorder treats each
 * message as opaque JSON. We only need a stable structural contract here.
 */
import type { z, ZodRawShape } from 'zod/v4';

export type CallToolResult = {
	content: Array<
		| { type: 'text'; text: string }
		| { type: 'image'; data: string; mimeType: string }
		| Record< string, unknown >
	>;
	isError?: boolean;
};

/**
 * Shape returned by the `tool()` helper. Mirrors the Claude Agent SDK's
 * `SdkMcpToolDefinition` so existing tool files keep their authoring style:
 * `tool(name, description, zodInputSchema, async args => {...})`.
 *
 * `inputSchema` carries the raw zod shape (an object literal of zod fields),
 * not a wrapped `z.object()` — the pi adapter wraps it into `z.object()` to
 * derive a JSON Schema for the LLM. The handler receives the inferred input
 * type and returns a `CallToolResult`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface SdkMcpToolDefinition< Schema extends ZodRawShape = any > {
	name: string;
	description: string;
	inputSchema: Schema;
	handler: ( args: z.infer< z.ZodObject< Schema > >, extra: unknown ) => Promise< CallToolResult >;
}

/**
 * Synthetic SDKMessage shape. The unified runtime emits these; the recorder
 * persists them verbatim (JSONL); the UI in `ui.ts` and `output-adapter.ts`
 * pattern-matches on `type` and `subtype`. We intentionally keep this loose —
 * it's a JSON contract, not a behavioral one.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SDKMessage = any;
