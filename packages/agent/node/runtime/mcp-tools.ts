import { readFile } from 'fs/promises';
import path from 'path';
import { getConfigDirectory } from '@studio/common/lib/well-known-paths';
import type { Confirmation, Confirmer } from './confirmation';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { RemoteHost } from '@studio/agent/node/remote-hosts';

// Studio Code's tools from MCP servers: each host's own, when the user is
// signed in to it, and any the user lists in ~/.studio/mcp.json under "mcpServers",
// in the shape other MCP hosts use ({ url, headers } or { command, args, env }).
// Each server's tools are served as its own description says, named
// `<server>_<tool>`.

export interface McpServerSpec {
	name: string;
	url?: string;
	headers?: Record< string, string >;
	command?: string;
	args?: string[];
	env?: Record< string, string >;
	// How the server asks for the user's approval of a call it won't run
	// without it. The harness asks the user, so the model never sets it.
	approval?: McpApproval;
	// Whether the server is part of Studio, so its tool names may be reported.
	builtIn?: boolean;
}

export interface McpApproval {
	// The boolean argument that tells the server the user approved the call.
	argument: string;
	// The question in a result that asks for approval, if the result asks.
	request( result: string ): Confirmation | undefined;
}

export async function readMcpServers(
	remoteHosts: Record< string, RemoteHost >
): Promise< McpServerSpec[] > {
	const servers: McpServerSpec[] = [];
	for ( const [ id, remoteHost ] of Object.entries( remoteHosts ) ) {
		const server = await remoteHost.mcpServer();
		if ( server ) {
			servers.push( { ...server, name: id, builtIn: true } );
		}
	}
	try {
		const file = JSON.parse(
			await readFile( path.join( getConfigDirectory(), 'mcp.json' ), 'utf8' )
		) as { mcpServers?: Record< string, Omit< McpServerSpec, 'name' > > };
		for ( const [ name, spec ] of Object.entries( file.mcpServers ?? {} ) ) {
			if ( spec.url || spec.command ) {
				servers.push( {
					name,
					url: spec.url,
					headers: spec.headers,
					command: spec.command,
					args: spec.args,
					env: spec.env,
				} );
			}
		}
	} catch {
		// No servers of the user's own.
	}
	return servers;
}

const CONNECT_TIMEOUT_MS = 15_000;
// How long a server that did not answer is left out, so a turn does not wait
// for its connection timeout again.
const RETRY_AFTER_MS = 5 * 60_000;
const listings = new Map< string, Promise< Listing > >();
const failedUntil = new Map< string, number >();

type Listing = { client: Client; tools: ListedTool[] };

const serverKey = ( server: McpServerSpec ) =>
	JSON.stringify( [
		server.name,
		server.url,
		server.headers,
		server.command,
		server.args,
		server.env,
	] );

// One connection per server for the life of the process, and its tools as
// listed once: a server whose tools change says so (MCP's
// notifications/tools/list_changed), and the list it sends then is kept. A
// failed connection is dropped, and the server left out for a while.
function listTools( server: McpServerSpec ): Promise< Listing > {
	const key = serverKey( server );
	let listing = listings.get( key );
	if ( ! listing ) {
		listing = ( async () => {
			const [ { Client }, transport ] = await Promise.all( [
				import( '@modelcontextprotocol/sdk/client/index.js' ),
				createTransport( server ),
			] );
			const client: Client = new Client(
				{ name: 'wordpress-studio', version: '1' },
				{
					listChanged: {
						tools: {
							onChanged: ( error, tools ) =>
								error || ! tools
									? listings.delete( key )
									: listings.set( key, Promise.resolve( { client, tools } ) ),
						},
					},
				}
			);
			await client.connect( transport, { timeout: CONNECT_TIMEOUT_MS } );
			const { tools } = await client.listTools( undefined, { timeout: CONNECT_TIMEOUT_MS } );
			return { client, tools };
		} )();
		listing.then(
			() => failedUntil.delete( key ),
			() => {
				if ( listings.get( key ) === listing ) {
					listings.delete( key );
				}
				failedUntil.set( key, Date.now() + RETRY_AFTER_MS );
			}
		);
		listings.set( key, listing );
	}
	return listing;
}

/** Connects to the servers and lists their tools ahead of the first turn that needs them. */
export function prepareMcpServers( remoteHosts: Record< string, RemoteHost > ): void {
	void readMcpServers( remoteHosts ).then( ( servers ) =>
		servers
			.filter( ( server ) => ( failedUntil.get( serverKey( server ) ) ?? 0 ) <= Date.now() )
			.forEach( ( server ) => listTools( server ).catch( () => undefined ) )
	);
}

async function createTransport( server: McpServerSpec ) {
	if ( server.url ) {
		const { StreamableHTTPClientTransport } = await import(
			// eslint-disable-next-line import-x/no-unresolved -- subpath resolved via package's wildcard export, which the lint resolver doesn't follow
			'@modelcontextprotocol/sdk/client/streamableHttp.js'
		);
		return new StreamableHTTPClientTransport( new URL( server.url ), {
			requestInit: { headers: server.headers },
		} );
	}
	const { StdioClientTransport, getDefaultEnvironment } = await import(
		'@modelcontextprotocol/sdk/client/stdio.js'
	);
	return new StdioClientTransport( {
		command: server.command as string,
		args: server.args,
		env: { ...getDefaultEnvironment(), ...server.env },
		stderr: 'ignore',
	} );
}

interface McpContent {
	type: string;
	text?: string;
	data?: string;
	mimeType?: string;
	resource?: { text?: string; uri?: string };
}

function toContent( content: McpContent[] ) {
	return content.map( ( item ) =>
		item.type === 'image' && item.data && item.mimeType
			? { type: 'image' as const, data: item.data, mimeType: item.mimeType }
			: {
					type: 'text' as const,
					text: item.text ?? item.resource?.text ?? JSON.stringify( item ),
			  }
	);
}

function textOf( content: McpContent[] ): string {
	return content.map( ( item ) => item.text ?? '' ).join( '\n' );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type McpTool = AgentTool< any >;

// Names of tools from the user's own servers, which telemetry leaves out.
const userToolNames = new Set< string >();

export function isUserMcpTool( name: string ): boolean {
	return userToolNames.has( name );
}

type ListedTool = Awaited< ReturnType< Client[ 'listTools' ] > >[ 'tools' ][ number ];

const toolName = ( server: McpServerSpec, tool: ListedTool ) =>
	`${ server.name }_${ tool.name }`.replace( /[^A-Za-z0-9_-]/g, '_' ).slice( 0, 64 );

/**
 * The tools of every server that answers. A server that doesn't connect is
 * left out for a while. A tool whose name is `reserved` (the harness's own
 * tools) or an earlier server's is left out, so it never takes on the
 * behavior the harness gives that name.
 */
export async function createMcpTools(
	servers: McpServerSpec[],
	confirm: Confirmer,
	reserved: Iterable< string > = []
): Promise< McpTool[] > {
	const lists = await Promise.all(
		servers.map( async ( server ) => {
			const key = serverKey( server );
			if ( ( failedUntil.get( key ) ?? 0 ) > Date.now() ) {
				return [];
			}
			try {
				const { client, tools } = await listTools( server );
				return tools.map( ( tool ) => ( { server, client, tool } ) );
			} catch {
				return [];
			}
		} )
	);
	const taken = new Set( reserved );
	return lists
		.flat()
		.filter( ( { server, tool } ) => {
			const name = toolName( server, tool );
			const free = ! taken.has( name );
			taken.add( name );
			return free;
		} )
		.map( ( { server, client, tool } ) => createMcpTool( server, client, tool, confirm ) );
}

function createMcpTool(
	server: McpServerSpec,
	client: Client,
	tool: ListedTool,
	confirm: Confirmer
): McpTool {
	const name = toolName( server, tool );
	const parameters = structuredClone( tool.inputSchema ) as {
		properties?: Record< string, unknown >;
		required?: string[];
	};
	if ( ! server.builtIn ) {
		userToolNames.add( name );
	}
	const approval = server.approval;
	if ( approval && parameters.properties?.[ approval.argument ] ) {
		delete parameters.properties[ approval.argument ];
		parameters.required = parameters.required?.filter( ( key ) => key !== approval.argument );
	}
	const call = async ( args: Record< string, unknown >, signal?: AbortSignal ) => {
		const result = await client.callTool( { name: tool.name, arguments: args }, undefined, {
			signal,
			timeout: 10 * 60_000,
		} );
		return {
			content: ( result.content ?? [] ) as McpContent[],
			isError: Boolean( result.isError ),
		};
	};
	return {
		name,
		label: name,
		description: tool.description ?? '',
		parameters: parameters as McpTool[ 'parameters' ],
		async execute( _toolCallId, params, signal ) {
			const args = { ...( params as Record< string, unknown > ) };
			if ( approval ) {
				delete args[ approval.argument ];
			}
			let result = await call( args, signal );
			const question = result.isError ? approval?.request( textOf( result.content ) ) : undefined;
			if ( approval && question ) {
				const declined = await confirm( question );
				if ( declined?.endsTurn ) {
					return {
						content: [ { type: 'text', text: declined.text } ],
						details: {},
						terminate: true,
					};
				}
				if ( declined ) {
					throw new Error( declined.text );
				}
				result = await call( { ...args, [ approval.argument ]: true }, signal );
			}
			if ( result.isError ) {
				throw new Error( textOf( result.content ) );
			}
			return { content: toContent( result.content ), details: {} };
		},
	};
}
