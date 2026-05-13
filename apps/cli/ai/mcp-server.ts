// eslint-disable-next-line import-x/no-unresolved -- subpath resolved via package's wildcard export, which the lint resolver doesn't follow
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
	// eslint-disable-next-line import-x/no-unresolved -- subpath resolved via package's wildcard export, which the lint resolver doesn't follow
} from '@modelcontextprotocol/sdk/types.js';
import { resolveStudioToolDefinitions } from 'cli/ai/tools';
import type { StudioAgentTool } from 'cli/ai/tools/define-tool';

// Uses the low-level Server API rather than McpServer.registerTool, which only
// accepts zod-shaped inputs — our tools are typebox JSON Schema.
export async function startMcpStdioServer(): Promise< void > {
	const tools = resolveStudioToolDefinitions() as StudioAgentTool[];
	const toolsByName = new Map( tools.map( ( tool ) => [ tool.name, tool ] ) );

	const server = new Server(
		{ name: 'studio', version: '1.0.0' },
		{ capabilities: { tools: {} } }
	);

	server.setRequestHandler( ListToolsRequestSchema, async () => ( {
		tools: tools.map( ( tool ) => ( {
			name: tool.name,
			description: tool.description,
			inputSchema: tool.parameters as unknown as Record< string, unknown >,
		} ) ),
	} ) );

	server.setRequestHandler( CallToolRequestSchema, async ( request ) => {
		const tool = toolsByName.get( request.params.name );
		if ( ! tool ) {
			throw new Error( `Unknown tool: ${ request.params.name }` );
		}
		// MCP wants `{content, isError}`; pi-native handlers throw — translate.
		try {
			const result = await tool.rawHandler( ( request.params.arguments ?? {} ) as never );
			return { content: result.content, isError: false };
		} catch ( error ) {
			const message = error instanceof Error ? error.message : String( error );
			return {
				content: [ { type: 'text' as const, text: message } ],
				isError: true,
			};
		}
	} );

	const transport = new StdioServerTransport();
	const shutdown = async () => {
		await server.close();
		process.exit( 0 );
	};
	process.on( 'SIGINT', shutdown );
	process.on( 'SIGTERM', shutdown );

	await server.connect( transport );
}
