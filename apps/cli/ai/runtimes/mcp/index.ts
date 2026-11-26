import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {
	CLIENT_CAPABILITIES_META_KEY,
	CLIENT_INFO_META_KEY,
	McpServer,
	type ClientCapabilities,
	type Implementation,
	type ServerContext,
	type Tool,
	type Transport,
} from '@modelcontextprotocol/server';
import { SKILLS_EXTENSION_ID, SkillsExtension } from '@modelcontextprotocol/server/ext/skills';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import {
	bindTool,
	createAgent,
	type AnyStudioAgentTool,
	type DesignTracksContext,
	type HostSkills,
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
	listServedUserSkills,
	readServedSkillFile,
	servedStudioSkills,
} from 'cli/ai/runtimes/mcp/skills';
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

function describeClient( info?: Implementation, capabilities?: ClientCapabilities ): ClientSupport {
	const codex = info?.name === 'codex-mcp-client';
	const extensions = capabilities?.extensions;
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
	hostSkills?: HostSkills,
	tracks?: DesignTracksContext
): ServedTool[] {
	const tools = agent.tools( {
		imageGeneration: imageGeneration && ! client.ownImageTool,
		canAskUser: true,
		imageLink: ( file ) => ( client.fileImageLinks ? pathToFileURL( file ).href : file ),
		picker: client.apps,
		hostSkills,
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

// The skills for hosts with the Skills extension: the ones users ask Studio for directly, and
// the user's own for all sites.
function serveSkills( mcp: McpServer, onRequest: ( context: ServerContext ) => void ) {
	new SkillsExtension( {
		source: {
			list: async ( _params, context ) => {
				onRequest( context );
				return { skills: await listServedSkills() };
			},
			get: async ( uri, context ) => {
				onRequest( context );
				return getServedSkill( uri );
			},
			read: readServedSkillFile,
		},
	} ).attach( mcp );
}

// What a request on the 2026-07-28 revision says about its client. The SDK types the envelope
// without its keys.
interface ClientEnvelope {
	[ CLIENT_INFO_META_KEY ]?: Implementation;
	[ CLIENT_CAPABILITIES_META_KEY ]?: ClientCapabilities;
}

interface Session {
	agent: StudioAgent;
	host: StudioAgentHost;
	id: string;
	imageGeneration: boolean;
}

// One server for one connection. The tools go through the low-level handlers rather than
// McpServer.registerTool: they depend on the client, and they answer invalid arguments with a
// tool error the model can read. A client on the 2025 revisions names itself once, when it
// connects; one on 2026-07-28 does so in every request.
function createServer( { agent, host, id, imageGeneration }: Session ): McpServer {
	const mcp = new McpServer(
		{ name: 'studio', version: '1.0.0' },
		{
			instructions:
				'WordPress Studio builds and manages local WordPress sites. Before any WordPress site task, call studio_instructions and follow what it returns.',
		}
	);
	const server = mcp.server;
	server.registerCapabilities( { tools: { listChanged: true } } );
	let client = describeClient();
	let known = false;
	let tracks: DesignTracksContext | undefined;
	const hostSkills = (): HostSkills | undefined =>
		client.skills
			? {
					studio: servedStudioSkills(),
					user: async () =>
						( await listServedUserSkills() ).map( ( skill ) => skill.frontmatter.name ),
			  }
			: undefined;
	const createClientTools = () =>
		createTools( agent, host, client, imageGeneration, hostSkills(), tracks );
	let tools = createClientTools();

	// The MCP App pages, hidden until a client that renders MCP Apps is known.
	const pages = appPages().map( ( { uri, name, text, _meta } ) =>
		mcp.registerResource( name, uri, { mimeType: MCP_APP_MIME_TYPE, _meta }, () => ( {
			contents: [ { uri, mimeType: MCP_APP_MIME_TYPE, text, _meta } ],
		} ) )
	);
	pages.forEach( ( page ) => page.disable() );

	const meetClient = ( context?: ServerContext ) => {
		const envelope: ClientEnvelope | undefined = context?.mcpReq.envelope;
		const info = envelope?.[ CLIENT_INFO_META_KEY ] ?? server.getClientVersion();
		const capabilities =
			envelope?.[ CLIENT_CAPABILITIES_META_KEY ] ?? server.getClientCapabilities();
		// A request on 2026-07-28 always states the capabilities, but need not name the client.
		if ( known || ! ( info || capabilities ) ) {
			return;
		}
		known = true;
		client = describeClient( info, capabilities );
		if ( client.apps ) {
			pages.forEach( ( page ) => page.enable() );
		}
		process.env.STUDIO_MCP_CLIENT = info?.name ?? '';
		tracks = {
			ai_session_id: id,
			agent_name: info?.name || 'unknown',
			client: 'studio-mcp',
		};
		tools = createClientTools();
		void recordTracksEvent( TRACKS_EVENTS.MCP_SESSION_START, {
			...getTracksOrigin(),
			mcp_apps: client.apps,
		} ).catch( () => undefined );
	};
	server.oninitialized = () => meetClient();

	serveSkills( mcp, ( context ) => {
		meetClient( context );
		if ( client.skills ) {
			return;
		}
		client.skills = true;
		tools = createClientTools();
		// studio_instructions no longer lists Studio's skills, which the host now shows itself.
		if ( servedStudioSkills().length ) {
			void server.sendToolListChanged().catch( () => undefined );
		}
	} );

	server.setRequestHandler( 'tools/list', async ( _request, context ) => {
		meetClient( context );
		return {
			tools: tools.map( ( { tool, listing } ) => ( {
				name: tool.name,
				description: tool.description,
				inputSchema: tool.parameters as unknown as Tool[ 'inputSchema' ],
				annotations: tool.annotations,
				...listing,
			} ) ),
		};
	} );

	server.setRequestHandler( 'tools/call', async ( request, context ) => {
		meetClient( context );
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

	return mcp;
}

// Serves one client, over the process's stdio unless given another transport.
export async function serveMcp( transport?: Transport ) {
	const host = cliAgentHost;
	const session: Session = {
		agent: createAgent( { host } ),
		host,
		id: randomUUID(),
		imageGeneration: Boolean( await host.imageGenerator?.() ),
	};
	// The client picks the protocol revision when it connects. One that asks which revisions
	// the server has gets a server of its own for the answer, hence a server per call.
	return serveStdio( () => createServer( session ), { transport } );
}

export async function startMcpStdioServer(): Promise< void > {
	// Tells this process's events, and those of the processes it starts, apart
	// from terminal use. The plugin's MCP config sets STUDIO_PLUGIN_ID.
	process.env.STUDIO_TRACKS_ORIGIN = 'studio-mcp';
	const connection = await serveMcp();
	const shutdown = async () => {
		await connection.close();
		process.exit( 0 );
	};
	process.on( 'SIGINT', shutdown );
	process.on( 'SIGTERM', shutdown );
}
