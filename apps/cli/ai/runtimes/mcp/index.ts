import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { McpServer, type Server, type Tool } from '@modelcontextprotocol/server';
import { SKILLS_EXTENSION_ID, SkillsExtension } from '@modelcontextprotocol/server/ext/skills';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
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
import {
	getServedSkill,
	listServedSkills,
	readServedSkillFile,
} from 'cli/ai/runtimes/mcp/user-skills';
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
	// Offers the skills this server serves and loads them itself. A host need not declare the
	// Skills extension, so one that asks for the skills counts too.
	skills: boolean;
	// Gets wpcom_request, which reaches any WordPress.com endpoint. OpenAI's plugin
	// review asks for a tool per operation instead, so Codex goes without it for now.
	wpcomRequest: boolean;
}

function describeClient( server: Server ): ClientSupport {
	const codex = server.getClientVersion()?.name === 'codex-mcp-client';
	const extensions = server.getClientCapabilities()?.extensions;
	return {
		// Codex renders MCP Apps without declaring the extension.
		apps: codex || Boolean( extensions?.[ 'io.modelcontextprotocol/ui' ] ),
		fileImageLinks: codex,
		ownImageTool: codex,
		skills: Boolean( extensions?.[ SKILLS_EXTENSION_ID ] ),
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
	skillsLoadedByHost: () => Promise< string[] >,
	tracks?: DesignTracksContext
): ServedTool[] {
	const tools = agent.tools( {
		imageGeneration: imageGeneration && ! client.ownImageTool,
		canAskUser: true,
		imageLink: ( file ) => ( client.fileImageLinks ? pathToFileURL( file ).href : file ),
		picker: client.apps,
		skillsLoadedByHost,
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

// The user's skills for all sites, for hosts with the Skills extension. Studio's own skills
// stay with studio_instructions: the wp-studio plugin already lists them, and they build on
// the rules it returns.
function serveUserSkills( mcp: McpServer, onRequest: () => void ) {
	new SkillsExtension( {
		source: {
			list: async () => {
				onRequest();
				return { skills: await listServedSkills() };
			},
			get: async ( uri ) => {
				onRequest();
				return getServedSkill( uri );
			},
			read: readServedSkillFile,
		},
	} ).attach( mcp );
}

// The tools go through the low-level handlers rather than McpServer.registerTool: they
// depend on the client, known only once it has connected, and they answer invalid
// arguments with a tool error the model can read.
export async function startMcpStdioServer(): Promise< void > {
	// Tells this process's events, and those of the processes it starts, apart
	// from terminal use. The plugin's MCP config sets STUDIO_PLUGIN_ID.
	process.env.STUDIO_TRACKS_ORIGIN = 'studio-mcp';
	const host = cliAgentHost;
	const agent = createAgent( { host } );
	const sessionId = randomUUID();
	const imageGeneration = Boolean( await host.imageGenerator?.() );
	const mcp = new McpServer(
		{ name: 'studio', version: '1.0.0' },
		{
			instructions:
				'WordPress Studio builds and manages local WordPress sites. Before any WordPress site task, call studio_instructions and follow what it returns.',
		}
	);
	const server = mcp.server;
	server.registerCapabilities( { tools: {} } );
	// The tools depend on what the client supports, known once it has connected.
	let client = describeClient( server );
	const skillsLoadedByHost = async () =>
		client.skills ? ( await listServedSkills() ).map( ( skill ) => skill.frontmatter.name ) : [];
	let tools = createTools( agent, host, client, imageGeneration, skillsLoadedByHost );

	// The MCP App pages. Only clients that render MCP Apps get them.
	const pages = appPages().map( ( { uri, name, text, _meta } ) =>
		mcp.registerResource( name, uri, { mimeType: MCP_APP_MIME_TYPE, _meta }, () => ( {
			contents: [ { uri, mimeType: MCP_APP_MIME_TYPE, text, _meta } ],
		} ) )
	);
	serveUserSkills( mcp, () => {
		client.skills = true;
	} );

	server.oninitialized = () => {
		client = describeClient( server );
		if ( ! client.apps ) {
			pages.forEach( ( page ) => page.disable() );
		}
		process.env.STUDIO_MCP_CLIENT = server.getClientVersion()?.name ?? '';
		tools = createTools( agent, host, client, imageGeneration, skillsLoadedByHost, {
			ai_session_id: sessionId,
			agent_name: process.env.STUDIO_MCP_CLIENT || 'unknown',
			client: 'studio-mcp',
		} );
		void recordTracksEvent( TRACKS_EVENTS.MCP_SESSION_START, {
			...getTracksOrigin(),
			mcp_apps: client.apps,
		} ).catch( () => undefined );
	};

	server.setRequestHandler( 'tools/list', async () => ( {
		tools: tools.map( ( { tool, listing } ) => ( {
			name: tool.name,
			description: tool.description,
			inputSchema: tool.parameters as unknown as Tool[ 'inputSchema' ],
			annotations: tool.annotations,
			...listing,
		} ) ),
	} ) );

	server.setRequestHandler( 'tools/call', async ( request ) => {
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

	const transport = new StdioServerTransport();
	const shutdown = async () => {
		await mcp.close();
		process.exit( 0 );
	};
	process.on( 'SIGINT', shutdown );
	process.on( 'SIGTERM', shutdown );

	await mcp.connect( transport );
}
