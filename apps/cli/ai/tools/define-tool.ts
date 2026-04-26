import type { CallToolResult, SdkMcpToolDefinition } from 'cli/ai/sdk-message-types';
import type { z, ZodRawShape } from 'zod/v4';

/**
 * Local replacement for the Claude Agent SDK's `tool()` helper. Same call
 * signature so the 24 tool files in this directory authored against the SDK
 * continue to work unchanged after we drop `@anthropic-ai/claude-agent-sdk`
 * as a dependency.
 *
 * The pi adapter (`runtimes/pi/pi-tool-adapter.ts`) consumes the result as
 * `SdkMcpToolDefinition[]`, wraps `inputSchema` into a `z.object()` to derive
 * a JSON Schema, and bridges `handler` into pi-agent-core's `AgentTool.execute`
 * contract.
 */
export function tool< Schema extends ZodRawShape >(
	name: string,
	description: string,
	inputSchema: Schema,
	handler: ( args: z.infer< z.ZodObject< Schema > >, extra: unknown ) => Promise< CallToolResult >
): SdkMcpToolDefinition< Schema > {
	return { name, description, inputSchema, handler };
}
