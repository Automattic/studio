import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { studioToolDefinitions } from 'cli/ai/tools';

/**
 * Stand up the Studio MCP stdio server. This is the `studio mcp` command's
 * runtime — it exposes Studio's tool catalog to external MCP clients
 * (Claude Code, Codex, etc.) over stdio.
 *
 * Pre-pi-migration this lived inside the Claude Agent SDK's
 * `createSdkMcpServer` helper. Now we wire each Studio tool into the MCP
 * SDK's `McpServer` directly using its `registerTool` API. The tool
 * definitions themselves are unchanged — same name, description, zod
 * inputSchema, and handler that returns `{ content, isError? }`.
 *
 * Our handler shape and the MCP SDK's `CallToolResult` line up structurally
 * at runtime, but the SDK declares a narrower `content` union (including
 * resource_link / embedded_resource block kinds we never emit). The
 * `unknown` cast on the registration call documents that mismatch — we don't
 * want to fold those richer shapes into our local `CallToolResult` since the
 * agent runtime would have nothing useful to do with them either.
 */
export async function startMcpStdioServer(): Promise< void > {
	const server = new McpServer( { name: 'studio', version: '1.0.0' } );

	for ( const definition of studioToolDefinitions ) {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		( server.registerTool as any )(
			definition.name,
			{
				description: definition.description,
				inputSchema: definition.inputSchema,
			},
			async ( args: Record< string, unknown > ) => {
				return ( await definition.handler( args as never, null ) ) as unknown;
			}
		);
	}

	const transport = new StdioServerTransport();

	const shutdown = async () => {
		await server.close();
		process.exit( 0 );
	};
	process.on( 'SIGINT', shutdown );
	process.on( 'SIGTERM', shutdown );

	await server.connect( transport );
}
