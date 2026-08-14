import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { adapters, findAdapter } from './adapters/index.js';
import { captureWebsite as runCapture } from './lib/capture.js';
import type { HandlerContext, ToolResult } from './mcp-server/handler-types.js';

function textResult(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function errorResult(message: string): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

const server = {
  sendLoggingMessage: async () => undefined,
} as unknown as Server;

const context: HandlerContext = { adapters, findAdapter, textResult, errorResult, server };

export async function captureWebsite(args: Record<string, unknown>): Promise<unknown> {
  const result = await runCapture(args, context);
  const text = result.content.map((part) => part.text).join('\n').trim();
  if (result.isError) {
    throw new Error(text || 'Data Liberation capture failed.');
  }
  return text ? JSON.parse(text) : {};
}
