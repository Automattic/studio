import { pathToFileURL } from 'node:url';
// eslint-disable-next-line import-x/no-unresolved -- subpath resolved via package's wildcard export, which the lint resolver doesn't follow
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
	// eslint-disable-next-line import-x/no-unresolved -- subpath resolved via package's wildcard export, which the lint resolver doesn't follow
} from '@modelcontextprotocol/sdk/types.js';
import { Type } from 'typebox';
import { isImageGenerationAvailable } from 'cli/ai/image-generation';
import { loadSkills } from 'cli/ai/skills';
import { buildSystemPrompt } from 'cli/ai/system-prompt';
import { resolveStudioToolDefinitions } from 'cli/ai/tools';
import { defineTool, type StudioAgentTool } from 'cli/ai/tools/define-tool';
import { createPresentDesignOptionsTool } from 'cli/ai/tools/present-design-options';
import { renderSkill } from 'cli/ai/tools/skill';
import { textResult } from 'cli/ai/tools/utils';

// Uses the low-level Server API rather than McpServer.registerTool, which only
// accepts zod-shaped inputs — our tools are typebox JSON Schema.
export async function startMcpStdioServer(): Promise< void > {
	// The ChatGPT desktop app (Codex) shows a local image only from a file:// link;
	// Claude's desktop app opens a bare path in its side panel but blocks file:// links.
	const imageLink = ( file: string ) =>
		server.getClientVersion()?.name === 'codex-mcp-client' ? pathToFileURL( file ).href : file;
	const studioTools = [
		...resolveStudioToolDefinitions( {
			imageGeneration: await isImageGenerationAvailable(),
			canAskUser: true,
			imageLink,
		} ),
		createPresentDesignOptionsTool( undefined, undefined, imageLink ),
	];
	// Fetched on demand rather than sent as the server's instructions, which
	// hosts keep in context for every conversation and may truncate.
	const instructionsTool = defineTool(
		'studio_instructions',
		"Returns how to build and manage WordPress sites with the Studio tools: the site workflow, when to load which skill, and the rules the result must follow. Call it before your first WordPress site task and follow it. With `skill`, returns that skill's runbook instead.",
		{
			skill: Type.Optional(
				Type.Enum(
					loadSkills().map( ( skill ) => skill.name ),
					{ description: 'A skill the instructions name.' }
				)
			),
		},
		async ( args ) =>
			textResult(
				args.skill
					? renderSkill( args.skill )
					: buildSystemPrompt( { external: true, tools: studioTools } )
			)
	);
	const tools = [ instructionsTool, ...studioTools ] as StudioAgentTool[];
	const toolsByName = new Map( tools.map( ( tool ) => [ tool.name, tool ] ) );

	const server = new Server(
		{ name: 'studio', version: '1.0.0' },
		{
			capabilities: { tools: {} },
			instructions:
				'WordPress Studio builds and manages local WordPress sites. Before any WordPress site task, call studio_instructions and follow what it returns.',
		}
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
			const report = await result.pending;
			return {
				content: report
					? [ ...result.content, { type: 'text' as const, text: report } ]
					: result.content,
				isError: false,
			};
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
