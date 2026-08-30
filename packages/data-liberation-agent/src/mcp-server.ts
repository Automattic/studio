// src/mcp-server.ts
//
// MCP as a transport, not an architecture.
//
// The product is three verbs, so this exposes three tools that call the same
// entry points the CLI calls. It deliberately does not expose pipeline phases:
// a caller that has to drive discovery, capture, and export in sequence is
// reimplementing the CLI, and the surface then has to be maintained against
// every internal change.
//
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { resolveOutputBase } from './lib/paths.js';

/**
 * MCP tool result envelope. The index signature is what keeps it assignable to
 * the SDK's ServerResult union, which is declared with `[key: string]: unknown`.
 */
interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}

const textResult = (data: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
});

const errorResult = (message: string): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
  isError: true,
});

const TOOLS = [
  {
    name: 'liberate',
    description:
      'Liberate a website into a complete, portable HTML site. Returns the run directory, the website directory, and route counts.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Site to liberate.' },
        outputDir: { type: 'string', description: 'Output base directory. Defaults to ~/data-liberation.' },
        resume: { type: 'boolean', description: 'Reuse artifacts already on disk instead of recapturing.' },
        screenshots: { type: 'boolean', description: 'Also capture full-page and scrolled PNGs.' },
      },
      required: ['url'],
    },
  },
  {
    name: 'compare',
    description:
      'Verify a liberated copy: self-consistency across every route, and source fidelity across a sample. Returns the report, including whether it passed.',
    inputSchema: {
      type: 'object',
      properties: {
        directory: { type: 'string', description: 'A liberated run directory.' },
        screenshots: { type: 'boolean', description: 'Write source/copy/diff PNGs as evidence.' },
      },
      required: ['directory'],
    },
  },
  {
    name: 'publish',
    description: 'Publish a liberated site to a live URL. Returns the live URL and any claim link.',
    inputSchema: {
      type: 'object',
      properties: {
        directory: { type: 'string', description: 'A liberated run directory.' },
        target: { type: 'string', description: 'Publish target. Defaults to spacefast.' },
        token: { type: 'string', description: 'Token for the target, if publishing into an account.' },
      },
      required: ['directory'],
    },
  },
];

const server = new Server(
  { name: 'data-liberation', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name } = request.params;
  const args = (request.params.arguments ?? {}) as Record<string, unknown>;
  const log = (message: string) => {
    void server.sendLoggingMessage({ level: 'info', data: message }).catch(() => undefined);
  };

  try {
    if (name === 'liberate') {
      const { liberateSite } = await import('./ui/liberate.js');
      const result = await liberateSite({
        url: String(args.url ?? ''),
        outputBase: typeof args.outputDir === 'string' ? args.outputDir : resolveOutputBase(),
        resume: args.resume === true,
        screenshots: args.screenshots === true,
        // A tool call has no terminal to hold, so it never serves.
        serve: false,
        log,
      });
      return textResult({
        websiteDir: result.websiteDir,
        routesDiscovered: result.routesDiscovered,
        routesCaptured: result.routesCaptured,
        routesSkipped: result.routesSkipped,
        routesFailed: result.routesFailed,
      });
    }

    if (name === 'compare') {
      const { checkFidelity } = await import('./lib/fidelity/check.js');
      const report = await checkFidelity({
        directory: String(args.directory ?? ''),
        screenshots: args.screenshots === true,
        log,
      });
      return textResult(report);
    }

    if (name === 'publish') {
      const { publishSite } = await import('./ui/publish.js');
      const result = await publishSite({
        directory: String(args.directory ?? ''),
        target: typeof args.target === 'string' ? args.target : 'spacefast',
        token: typeof args.token === 'string' ? args.token : process.env.SPACEFAST_TOKEN,
        log,
      });
      return textResult(result);
    }

    return errorResult(`Unknown tool: ${name}`);
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : String(error));
  }
});

async function main() {
  const transport = new StdioServerTransport();

  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
