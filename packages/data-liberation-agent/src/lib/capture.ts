import { safeFetch } from './media-fetch/safe-fetch.js';
import { extractHandler } from '../mcp-server/handlers/extract.js';
import type { HandlerContext, ToolResult } from '../mcp-server/handler-types.js';

export async function captureWebsite(
  args: Record<string, unknown>,
  context: HandlerContext,
): Promise<ToolResult> {
  const response = await safeFetch(String(args.url ?? ''), { timeoutMs: 10_000 });
  return extractHandler(
    {
      ...args,
      url: response.finalUrl,
      screenshots: true,
      dryRun: false,
      publicUrlsOnly: true,
    },
    context,
  );
}
