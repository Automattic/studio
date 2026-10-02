import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
// eslint-disable-next-line import-x/no-unresolved -- subpath resolved via package's wildcard export, which the lint resolver doesn't follow
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
	CallToolRequestSchema,
	GetPromptRequestSchema,
	ListPromptsRequestSchema,
	ListResourcesRequestSchema,
	ListToolsRequestSchema,
	ReadResourceRequestSchema,
	// eslint-disable-next-line import-x/no-unresolved -- subpath resolved via package's wildcard export, which the lint resolver doesn't follow
} from '@modelcontextprotocol/sdk/types.js';
import { readGlobalInstructions } from '@studio/common/ai/global-instructions';
import { Type, type TSchema } from 'typebox';
import { Value } from 'typebox/value';
import { isImageGenerationAvailable } from 'cli/ai/image-generation';
import { buildSystemPrompt } from 'cli/ai/system-prompt';
import { resolveStudioToolDefinitions, type HostCapabilities } from 'cli/ai/tools';
import { defineTool, type AnyStudioAgentTool, type ToolResult } from 'cli/ai/tools/define-tool';
import { resolveSite, textResult } from 'cli/ai/tools/utils';
import { openBrowser } from 'cli/lib/browser';
import { ensureStudioUiServer, reloadSitePreview } from './companion-ui';
import {
	DESIGN_OPTIONS_APP_HTML,
	DESIGN_OPTIONS_APP_URI,
	MCP_APP_MIME_TYPE,
} from './design-options-app';
import { createLibraryTools } from './library';
import {
	LIBRARY_APP_HTML,
	LIBRARY_APP_ICON,
	LIBRARY_APP_META,
	LIBRARY_APP_URI,
} from './library-app';

const MCP_APPS_EXTENSION = 'io.modelcontextprotocol/ui';

interface ClientSupport {
	// The client renders MCP Apps (the WordPress library, the design picker).
	apps: boolean;
	// The client shares its workspace folders (MCP roots).
	roots: boolean;
	// The client's own image tool; Studio's image API is its fallback.
	imageTool?: string;
	// The client renders inline HTML widgets with a tool of its own.
	widgets: boolean;
}

// What known clients support beyond what they declare: Codex renders MCP Apps
// without always declaring the extension and ships image_gen on the user's own
// plan; Claude's apps render inline HTML widgets with their visualize tool.
const KNOWN_CLIENTS: Record< string, Partial< ClientSupport > > = {
	'codex-mcp-client': { apps: true, imageTool: 'image_gen' },
	'claude-code': { widgets: true },
	'claude-ai': { widgets: true },
};

interface CompanionUi {
	url: string;
	siteId: string;
}

export function mcpHostCapabilities(
	client: ClientSupport,
	options: {
		companion?: CompanionUi;
		displayDirectory?: () => Promise< string | undefined >;
		imageGeneration: boolean;
		reloadPreview: () => Promise< void >;
	}
): HostCapabilities {
	return {
		// The host's agent asks in its own conversation or with its own question
		// tool: the desktop apps dismiss MCP elicitation forms unseen.
		canAskUser: true,
		designPreviews: 'return',
		designOptionsView: client.apps ? 'picker' : client.widgets ? 'widget' : undefined,
		displayDirectory: client.roots ? options.displayDirectory : undefined,
		reloadPreview: options.companion ? options.reloadPreview : undefined,
		imageGeneration: options.imageGeneration,
		hostImageTool: client.imageTool,
		importImages: true,
		skills: true,
	};
}

export async function buildMcpInstructions( tools: AnyStudioAgentTool[] ): Promise< string > {
	return buildSystemPrompt( {
		host: 'external',
		tools,
		userInstructions: await readGlobalInstructions().catch( () => undefined ),
	} );
}

function readClientSupport( server: Server ): ClientSupport {
	const capabilities = server.getClientCapabilities() as
		| ( Record< string, unknown > & { extensions?: Record< string, unknown > } )
		| undefined;
	const known = KNOWN_CLIENTS[ server.getClientVersion()?.name ?? '' ] ?? {};
	return {
		apps: Boolean( capabilities?.extensions?.[ MCP_APPS_EXTENSION ] ) || known.apps === true,
		roots: Boolean( capabilities?.roots ),
		imageTool: known.imageTool,
		widgets: known.widgets === true,
	};
}

async function withInlineImages(
	structuredContent: Record< string, unknown >
): Promise< Record< string, unknown > > {
	const options = structuredContent.options as { image: string }[] | undefined;
	if ( ! options ) {
		return structuredContent;
	}
	return {
		...structuredContent,
		options: await Promise.all(
			options.map( async ( option ) => ( {
				...option,
				image: `data:image/${ path.extname( option.image ).slice( 1 ) };base64,${ (
					await readFile( option.image )
				).toString( 'base64' ) }`,
			} ) )
		),
	};
}

export async function startMcpStdioServer(): Promise< void > {
	const imageGeneration = await isImageGenerationAvailable();
	let companion: CompanionUi | undefined;
	let tools: AnyStudioAgentTool[] = [];
	let client: ClientSupport = { apps: false, roots: false, widgets: false };

	// The instructions are sent before the client says what it supports, so
	// they describe the full tool set.
	const instructions = await buildMcpInstructions(
		resolveStudioToolDefinitions( {
			canAskUser: true,
			designPreviews: 'return',
			reloadPreview: async () => undefined,
			imageGeneration,
			importImages: true,
			skills: true,
		} )
	);

	const server = new Server(
		{ name: 'wordpress-studio', version: '1.0.0' },
		{
			capabilities: { tools: { listChanged: true }, prompts: {}, resources: {} },
			instructions,
		}
	);

	// Hosts such as the Claude desktop app show local images only from the
	// session's folders, so previews for the user go in the first of them.
	const displayDirectory = async () => {
		const { roots } = await server.listRoots();
		const root = roots.find( ( candidate ) => candidate.uri.startsWith( 'file://' ) );
		if ( ! root ) {
			return undefined;
		}
		const folder = path.join( fileURLToPath( root.uri ), '.wordpress-studio' );
		await mkdir( folder, { recursive: true } );
		await writeFile( path.join( folder, '.gitignore' ), '*\n' );
		return folder;
	};

	const instructionsTool = defineTool(
		'studio_instructions',
		'Returns how to build and manage WordPress sites with the Studio tools: the site workflow, when to load which skill, and the rules the result must follow. Call it once, before your first site task, and follow it.',
		{},
		// Rebuilt from the tools this client has, unlike the handshake's
		// instructions, which are sent before the client is known.
		async () => textResult( await buildMcpInstructions( tools ) )
	);

	const openStudioUiTool = defineTool(
		'open_studio_ui',
		"Opens the Studio preview of a site in the user's browser, so they can watch it change while you work; refresh_browser then reloads it. Offer it when you start building or redesigning a site, and call it when the user agrees or asks to see the site.",
		{
			site: Type.String( { description: 'Name or path of the Studio site to preview.' } ),
		},
		async ( args ) => {
			const site = await resolveSite( args.site );
			const url = await ensureStudioUiServer();
			const opened = ! companion;
			companion = { url, siteId: site.id };
			const pageUrl = `${ url }/sites/${ encodeURIComponent( site.id ) }/overview`;
			await openBrowser( pageUrl ).catch( () => undefined );
			if ( opened ) {
				resolveTools();
				await server.sendToolListChanged().catch( () => undefined );
			}
			return textResult(
				`Opened the Studio preview of "${ site.name }" at ${ pageUrl }. Call refresh_browser after changes that alter what the site renders.`
			);
		}
	);

	const library = createLibraryTools();

	function resolveTools(): void {
		tools = [
			instructionsTool,
			...resolveStudioToolDefinitions(
				mcpHostCapabilities( client, {
					companion,
					displayDirectory,
					imageGeneration,
					reloadPreview: async () => {
						if ( companion ) {
							await reloadSitePreview( companion.url, companion.siteId );
						}
					},
				} )
			),
			openStudioUiTool,
			...( client.apps ? library.all : [] ),
		] as AnyStudioAgentTool[];
	}

	server.oninitialized = () => {
		client = readClientSupport( server );
		resolveTools();
	};
	resolveTools();

	server.setRequestHandler( ListToolsRequestSchema, async () => ( {
		tools: tools.map( ( tool ) => ( {
			name: tool.name,
			description: tool.description,
			inputSchema: tool.parameters as unknown as Record< string, unknown >,
			...( client.apps && tool.name === 'present_design_options'
				? { _meta: { ui: { resourceUri: DESIGN_OPTIONS_APP_URI } } }
				: {} ),
			// OpenAI's global entrypoint: a sidebar entry that opens the library.
			...( tool.name === library.open.name
				? {
						title: 'WordPress',
						icons: [ LIBRARY_APP_ICON ],
						_meta: {
							ui: { resourceUri: LIBRARY_APP_URI, visibility: [ 'app' ] },
							// OpenAI's entrypoints: the sidebar and a conversation tab.
							'openai/ui': { entrypoints: [ { type: 'global' }, { type: 'thread' } ] },
						},
				  }
				: {} ),
			...( library.appOnly.some( ( appTool ) => appTool.name === tool.name )
				? { _meta: { ui: { resourceUri: LIBRARY_APP_URI, visibility: [ 'app' ] } } }
				: {} ),
		} ) ),
	} ) );

	server.setRequestHandler( CallToolRequestSchema, async ( request, extra ) => {
		const tool = tools.find( ( candidate ) => candidate.name === request.params.name );
		if ( ! tool ) {
			throw new Error( `Unknown tool: ${ request.params.name }` );
		}
		const args = request.params.arguments ?? {};
		const schema = tool.parameters as TSchema;
		if ( ! Value.Check( schema, args ) ) {
			const problems = Value.Errors( schema, args )
				.slice( 0, 3 )
				.map( ( error ) => `${ error.instancePath || 'arguments' } ${ error.message }` );
			return {
				content: [
					{
						type: 'text' as const,
						text: `Invalid arguments for ${ tool.name }: ${ problems.join(
							'; '
						) }. Call it again with the arguments its schema asks for.`,
					},
				],
				isError: true,
			};
		}
		const progressToken = request.params._meta?.progressToken;
		let progress = 0;
		// MCP wants `{content, isError}`; pi-native handlers throw — translate.
		try {
			const result: ToolResult = await tool.rawHandler( args as never, {
				onProgress: ( message ) => {
					if ( progressToken !== undefined ) {
						void extra
							.sendNotification( {
								method: 'notifications/progress',
								params: { progressToken, progress: ++progress, message },
							} )
							.catch( () => undefined );
					}
				},
			} );
			const report = await result.pending;
			return {
				content: report
					? [ ...result.content, { type: 'text' as const, text: report } ]
					: result.content,
				// Only MCP Apps read it; other clients such as Claude Code show it in
				// place of the text content, hiding the tool's instructions.
				...( result.structuredContent && client.apps
					? { structuredContent: await withInlineImages( result.structuredContent ) }
					: {} ),
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
		resources: [
			{
				uri: DESIGN_OPTIONS_APP_URI,
				name: 'Design options',
				mimeType: MCP_APP_MIME_TYPE,
			},
			{
				uri: LIBRARY_APP_URI,
				name: 'WordPress',
				mimeType: MCP_APP_MIME_TYPE,
				_meta: LIBRARY_APP_META,
			},
		],
	} ) );

	server.setRequestHandler( ReadResourceRequestSchema, async ( request ) => {
		const html = {
			[ DESIGN_OPTIONS_APP_URI ]: DESIGN_OPTIONS_APP_HTML,
			[ LIBRARY_APP_URI ]: LIBRARY_APP_HTML,
		}[ request.params.uri ];
		if ( ! html ) {
			throw new Error( `Unknown resource: ${ request.params.uri }` );
		}
		return {
			contents: [
				{
					uri: request.params.uri,
					mimeType: MCP_APP_MIME_TYPE,
					text: html,
					...( request.params.uri === LIBRARY_APP_URI ? { _meta: LIBRARY_APP_META } : {} ),
				},
			],
		};
	} );

	server.setRequestHandler( ListPromptsRequestSchema, async () => ( {
		prompts: [
			{
				name: 'build-site',
				description: 'Build a new WordPress site with Studio from a short brief.',
				arguments: [
					{ name: 'brief', description: 'What the site is for and how it should feel.' },
				],
			},
		],
	} ) );

	server.setRequestHandler( GetPromptRequestSchema, async ( request ) => {
		if ( request.params.name !== 'build-site' ) {
			throw new Error( `Unknown prompt: ${ request.params.name }` );
		}
		const brief = request.params.arguments?.brief?.trim();
		return {
			messages: [
				{
					role: 'user' as const,
					content: {
						type: 'text' as const,
						text: `Build a new WordPress site with WordPress Studio${
							brief ? `: ${ brief }` : '. Ask me what it is for first.'
						}\n\nCall studio_instructions first and follow them.`,
					},
				},
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
