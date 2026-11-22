import { randomUUID } from 'node:crypto';
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
import {
	bindTool,
	createAgent,
	type AnyStudioAgentTool,
	type DesignTracksContext,
	type StudioAgent,
	type StudioAgentHost,
} from '@studio/agent/node';
import { type TSchema } from 'typebox';
import { Value } from 'typebox/value';
import { cliAgentHost } from 'cli/ai/host';
import {
	DESIGN_PICKER_HTML,
	DESIGN_PICKER_URI,
	MCP_APP_MIME_TYPE,
} from 'cli/ai/runtimes/mcp/design-picker';
import { type AppPage, createLibraryTools, libraryPage } from 'cli/ai/runtimes/mcp/library';
import { runServedTool } from 'cli/ai/runtimes/mcp/served-tool';
import { getTracksOrigin, recordTracksEvent, TRACKS_EVENTS } from 'cli/lib/tracks';

interface ClientSupport {
	// Renders MCP Apps, such as the design picker.
	apps: boolean;
	// Shows a local image in its conversation only from a file:// link; Claude's
	// desktop app blocks those and opens a bare path in its side panel instead.
	fileImageLinks: boolean;
	// Makes images with a tool of its own, on the user's plan, which the
	// runbooks use when generate_images is left out.
	ownImageTool: boolean;
	// Gets wpcom_request, which reaches any WordPress.com endpoint. OpenAI's plugin
	// review asks for a tool per operation instead, so Codex goes without it for now.
	wpcomRequest: boolean;
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
		wpcomRequest: ! codex,
	};
}

interface ServedTool {
	tool: AnyStudioAgentTool;
	// What the tools list adds to the tool, such as the MCP App page it opens.
	listing?: Record< string, unknown >;
}

function createTools(
	agent: StudioAgent,
	host: StudioAgentHost,
	client: ClientSupport,
	imageGeneration: boolean,
	tracks?: DesignTracksContext
): ServedTool[] {
	const tools = agent.tools( {
		imageGeneration: imageGeneration && ! client.ownImageTool,
		canAskUser: true,
		imageLink: ( file ) => ( client.fileImageLinks ? pathToFileURL( file ).href : file ),
		picker: client.apps,
		tracks,
		wpcomRequest: client.wpcomRequest,
	} );
	const library = client.apps ? libraryPage() : null;
	return [
		...tools.map( ( tool ) => ( {
			tool,
			listing:
				client.apps && tool.name === 'present_design_options'
					? { _meta: { ui: { resourceUri: DESIGN_PICKER_URI } } }
					: undefined,
		} ) ),
		...( library
			? createLibraryTools( library.uri ).map( ( { tool, listing } ) => ( {
					tool: bindTool( tool, host ) as AnyStudioAgentTool,
					listing,
			  } ) )
			: [] ),
	];
}

// The MCP App pages: the design picker, and the WordPress library once built.
function appPages(): AppPage[] {
	const library = libraryPage();
	return [
		{ uri: DESIGN_PICKER_URI, name: 'Design options', text: DESIGN_PICKER_HTML },
		...( library ? [ library ] : [] ),
	];
}

// Uses the low-level Server API rather than McpServer.registerTool, which only
// accepts zod-shaped inputs — our tools are typebox JSON Schema.
export async function startMcpStdioServer(): Promise< void > {
	// Tells this process's events, and those of the processes it starts, apart
	// from terminal use. The plugin's MCP config sets STUDIO_PLUGIN_ID.
	process.env.STUDIO_TRACKS_ORIGIN = 'studio-mcp';
	const host = cliAgentHost;
	const agent = createAgent( { host } );
	const sessionId = randomUUID();
	const imageGeneration = Boolean( await host.imageGenerator?.() );
	const server = new Server(
		{ name: 'studio', version: '1.0.0' },
		{
			capabilities: { tools: {}, resources: {} },
			instructions:
				'WordPress Studio builds and manages local WordPress sites. If WordPress.com authentication is required, ask the user to sign in themselves in WordPress Studio, in the WordPress library if available, or by running `studio auth login` in their own terminal. Do not run login for them or ask for tokens in chat. Retry after the user confirms they are signed in. Local sites do not require login. Before any WordPress site task, call studio_instructions and follow what it returns.',
		}
	);
	// The tools depend on what the client supports, known once it has connected.
	let client = describeClient( server );
	let tools = createTools( agent, host, client, imageGeneration );
	server.oninitialized = () => {
		client = describeClient( server );
		process.env.STUDIO_MCP_CLIENT = server.getClientVersion()?.name ?? '';
		tools = createTools( agent, host, client, imageGeneration, {
			ai_session_id: sessionId,
			agent_name: process.env.STUDIO_MCP_CLIENT || 'unknown',
			client: 'studio-mcp',
		} );
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
		return runServedTool( tool, args );
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
