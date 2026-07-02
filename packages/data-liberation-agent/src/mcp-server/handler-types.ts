//
// MCP Handler Contract
// ====================
// Each tool's logic lives in its own handler module under handlers/<tool>.ts.
// mcp-server.ts is a thin router that imports handlers and dispatches by tool
// name. Handlers receive their args + a context with shared helpers (adapter
// registry, result wrappers, server reference for notifications).
//
// The context-object pattern (vs module-level globals) makes handlers
// unit-testable in isolation — pass a mock context, assert on the returned
// ToolResult.
//
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { PlatformAdapter } from '../types.js';

/**
 * MCP tool result envelope. Mirrors what setRequestHandler returns.
 * The index signature keeps it assignable to the SDK's ServerResult union
 * (which has [key: string]: unknown).
 */
export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}

/** Shared dependencies handlers receive. */
export interface HandlerContext {
  /** All registered platform adapters. */
  adapters: PlatformAdapter[];
  /** Find a registered adapter by platform id; returns null if unknown. */
  findAdapter(platform: string): PlatformAdapter | null;
  /** Wrap a JSON-serializable value as a tool result. */
  textResult(data: unknown): ToolResult;
  /** Wrap an error message as an isError tool result. */
  errorResult(message: string): ToolResult;
  /** The active MCP server instance — for sending notifications during long-running tools. */
  server: Server;
}

/**
 * Handler signature. The router converts the raw `arguments` payload into a
 * Record before dispatching, so handlers don't have to deal with optional
 * undefined args.
 */
export type Handler = (
  args: Record<string, unknown>,
  ctx: HandlerContext,
) => Promise<ToolResult>;
