import { pathToFileURL } from 'node:url';
// eslint-disable-next-line import-x/no-unresolved -- subpath resolved via package's wildcard export, which the lint resolver doesn't follow
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
	CallToolRequestSchema,
	ListResourcesRequestSchema,
	ListToolsRequestSchema,
	ReadResourceRequestSchema,
	// eslint-disable-next-line import-x/no-unresolved -- subpath resolved via package's wildcard export, which the lint resolver doesn't follow
} from '@modelcontextprotocol/sdk/types.js';
import { Type, type TSchema } from 'typebox';
import { Value } from 'typebox/value';
import { isImageGenerationAvailable } from 'cli/ai/image-generation';
import { DESIGN_PICKER_HTML, DESIGN_PICKER_URI, MCP_APP_MIME_TYPE } from 'cli/ai/mcp-design-picker';
import { loadSkills } from 'cli/ai/skills';
import { buildSystemPrompt } from 'cli/ai/system-prompt';
import { resolveStudioToolDefinitions } from 'cli/ai/tools';
import { defineTool, type StudioAgentTool } from 'cli/ai/tools/define-tool';
import { createPresentDesignOptionsTool } from 'cli/ai/tools/present-design-options';
import { renderSkill } from 'cli/ai/tools/skill';
import { textResult } from 'cli/ai/tools/utils';

interface ClientSupport {
	// Renders MCP Apps, such as the design picker.
	apps: boolean;
	// Shows a local image in its conversation only from a file:// link; Claude's
	// desktop app blocks those and opens a bare path in its side panel instead.
	fileImageLinks: boolean;
}

function describeClient( server: Server ): ClientSupport {
	const codex = server.getClientVersion()?.name === 'codex-mcp-client';
	const capabilities = server.getClientCapabilities() as
		| { extensions?: Record< string, unknown > }
		| undefined;
	return {
		// Codex renders MCP Apps without declaring the extension.
		apps: codex || Boolean( capabilities?.extensions?.[ 'io.modelcontextprotocol/ui' ] ),
		fileImageLinks: codex,
	};
}

function createTools( client: ClientSupport, imageGeneration: boolean ): StudioAgentTool[] {
	const imageLink = ( file: string ) =>
		client.fileImageLinks ? pathToFileURL( file ).href : file;
	const studioTools = [
		...resolveStudioToolDefinitions( { imageGeneration, canAskUser: true, imageLink } ),
		createPresentDesignOptionsTool( { imageLink, picker: client.apps } ),
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
	return [ instructionsTool, ...studioTools ] as StudioAgentTool[];
}

// Uses the low-level Server API rather than McpServer.registerTool, which only
// accepts zod-shaped inputs — our tools are typebox JSON Schema.
export async function startMcpStdioServer(): Promise< void > {
	const imageGeneration = await isImageGenerationAvailable();
	const server = new Server(
		{ name: 'studio', version: '1.0.0' },
		{
			capabilities: { tools: {}, resources: {} },
			instructions:
				'WordPress Studio builds and manages local WordPress sites. Before any WordPress site task, call studio_instructions and follow what it returns.',
		}
	);
	// The tools depend on what the client supports, known once it has connected.
	let client = describeClient( server );
	let tools = createTools( client, imageGeneration );
	server.oninitialized = () => {
		client = describeClient( server );
		tools = createTools( client, imageGeneration );
	};

	server.setRequestHandler( ListToolsRequestSchema, async () => ( {
		tools: tools.map( ( tool ) => ( {
			name: tool.name,
			description: tool.description,
			inputSchema: tool.parameters as unknown as Record< string, unknown >,
			...( client.apps && tool.name === 'present_design_options'
				? { _meta: { ui: { resourceUri: DESIGN_PICKER_URI } } }
				: {} ),
		} ) ),
	} ) );

	server.setRequestHandler( CallToolRequestSchema, async ( request ) => {
		const tool = tools.find( ( candidate ) => candidate.name === request.params.name );
		if ( ! tool ) {
			throw new Error( `Unknown tool: ${ request.params.name }` );
		}
		const args = request.params.arguments ?? {};
		const schema = tool.parameters as TSchema;
		if ( ! Value.Check( schema, args ) ) {
			const problems = [ ...Value.Errors( schema, args ) ]
				.slice( 0, 3 )
				.map( ( error ) => `${ error.instancePath || 'arguments' } ${ error.message }` );
			return {
				content: [
					{
						type: 'text' as const,
						text: `Invalid arguments for ${ tool.name }: ${ problems.join( '; ' ) }.`,
					},
				],
				isError: true,
			};
		}
		// MCP wants `{content, isError}`; pi-native handlers throw — translate.
		try {
			const result = await tool.rawHandler( args as never );
			const report = await result.pending;
			return {
				content: report
					? [ ...result.content, { type: 'text' as const, text: report } ]
					: result.content,
				structuredContent: result.structuredContent,
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

	server.setRequestHandler( ListResourcesRequestSchema, async () => ( {
		resources: [ { uri: DESIGN_PICKER_URI, name: 'Design options', mimeType: MCP_APP_MIME_TYPE } ],
	} ) );

	server.setRequestHandler( ReadResourceRequestSchema, async ( request ) => {
		if ( request.params.uri !== DESIGN_PICKER_URI ) {
			throw new Error( `Unknown resource: ${ request.params.uri }` );
		}
		return {
			contents: [
				{ uri: DESIGN_PICKER_URI, mimeType: MCP_APP_MIME_TYPE, text: DESIGN_PICKER_HTML },
			],
		};
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
