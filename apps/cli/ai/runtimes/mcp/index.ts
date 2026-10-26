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
import { createLibraryTools, libraryPage, MCP_APP_MIME_TYPE } from 'cli/ai/runtimes/mcp/library';
import { runServedTool } from 'cli/ai/runtimes/mcp/served-tool';
import { SiteChanges } from 'cli/ai/site-changes';
import { createSiteNotes } from 'cli/ai/site-notes';
import { loadSkills } from 'cli/ai/skills';
import { buildSystemPrompt } from 'cli/ai/system-prompt';
import { resolveStudioToolDefinitions } from 'cli/ai/tools';
import { defineTool, READ_ONLY, type StudioAgentTool } from 'cli/ai/tools/define-tool';
import { renderSkill } from 'cli/ai/tools/skill';
import { textResult } from 'cli/ai/tools/utils';
import { getTracksOrigin, recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';

interface ClientSupport {
	// Renders MCP Apps, such as the WordPress library.
	apps: boolean;
	// Shows a local image in its conversation only from a file:// link; Claude's
	// desktop app blocks those and opens a bare path in its side panel instead.
	fileImageLinks: boolean;
	// Makes images with a tool of its own, on the user's plan, which the
	// runbooks use when generate_images is left out.
	ownImageTool: boolean;
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
		ownImageTool: codex,
	};
}

interface ServedTool {
	tool: StudioAgentTool;
	// What the tools list adds to the tool, such as the MCP App page it opens.
	listing?: Record< string, unknown >;
}

function createTools( client: ClientSupport, imageGeneration: boolean ): ServedTool[] {
	const imageLink = ( file: string ) =>
		client.fileImageLinks ? pathToFileURL( file ).href : file;
	const definitions = resolveStudioToolDefinitions( {
		imageGeneration: imageGeneration && ! client.ownImageTool,
		imageLink,
	} );
	// Fetched on demand rather than sent as the server's instructions, which
	// hosts keep in context for every conversation and may truncate.
	const instructionsTool = defineTool(
		'studio_instructions',
		"Returns how to build and manage WordPress sites with the Studio tools: the rules every task follows and when to load which skill. Call it before your first WordPress site task and follow it. With `skill`, returns that skill's runbook instead. The skills for what users ask directly:\n" +
			loadSkills()
				.filter( ( skill ) => skill.userInvokable )
				.map( ( skill ) => `- ${ skill.name }: ${ skill.description }` )
				.join( '\n' ),
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
				args.skill ? renderSkill( args.skill ) : buildSystemPrompt( { external: true } )
			),
		{ annotations: READ_ONLY }
	);
	const library = client.apps ? libraryPage() : null;
	return [
		...[ instructionsTool, ...definitions ].map( ( tool ) => ( { tool } ) ),
		...( library ? createLibraryTools( library.uri ) : [] ),
	] as ServedTool[];
}

// The MCP App pages: the WordPress library, once built.
function appPages() {
	const library = libraryPage();
	return library ? [ library ] : [];
}

// Uses the low-level Server API rather than McpServer.registerTool, which only
// accepts zod-shaped inputs — our tools are typebox JSON Schema.
export async function startMcpStdioServer(): Promise< void > {
	// Tells this process's events, and those of the processes it starts, apart
	// from terminal use. The plugin's MCP config sets STUDIO_PLUGIN_ID.
	process.env.STUDIO_TRACKS_ORIGIN = 'studio-mcp';
	const siteNotes = createSiteNotes();
	const siteChanges = new SiteChanges();
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
		process.env.STUDIO_MCP_CLIENT = server.getClientVersion()?.name ?? '';
		tools = createTools( client, imageGeneration );
		void recordTracksEvent( TRACKS_EVENTS.MCP_SESSION_START, {
			...getTracksOrigin(),
			mcp_apps: client.apps,
		} ).catch( () => undefined );
	};

	server.setRequestHandler( ListToolsRequestSchema, async () => ( {
		tools: tools.map( ( { tool, listing } ) => ( {
			name: tool.name,
			description: tool.description,
			inputSchema: tool.parameters as unknown as Record< string, unknown >,
			annotations: tool.annotations,
			...listing,
		} ) ),
	} ) );

	server.setRequestHandler( CallToolRequestSchema, async ( request ) => {
		const tool = tools.find( ( served ) => served.tool.name === request.params.name )?.tool;
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
		return runServedTool( tool, args, siteNotes, siteChanges );
	} );

	// Only clients that render MCP Apps get the pages listed.
	server.setRequestHandler( ListResourcesRequestSchema, async () => ( {
		resources: ( client.apps ? appPages() : [] ).map( ( { uri, name, _meta } ) => ( {
			uri,
			name,
			mimeType: MCP_APP_MIME_TYPE,
			_meta,
		} ) ),
	} ) );

	server.setRequestHandler( ReadResourceRequestSchema, async ( request ) => {
		const page = appPages().find( ( candidate ) => candidate.uri === request.params.uri );
		if ( ! page ) {
			throw new Error( `Unknown resource: ${ request.params.uri }` );
		}
		const { uri, text, _meta } = page;
		return { contents: [ { uri, mimeType: MCP_APP_MIME_TYPE, text, _meta } ] };
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
