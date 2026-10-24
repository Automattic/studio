import { readFile } from 'fs/promises';
import path from 'path';
import { readAuthToken } from '@studio/common/lib/shared-config';
import { getConfigDirectory } from '@studio/common/lib/well-known-paths';
import type { Confirmation, Confirmer } from './confirmation';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

// Studio Code's tools from MCP servers: WordPress.com's own, when the user is
// logged in, and any the user lists in ~/.studio/mcp.json under "mcpServers",
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

const WPCOM_MCP_URL = 'https://public-api.wordpress.com/wpcom/v2/mcp/v2';
const WPCOM_PROMPT = '\n\nWhat to tell the user: ';

// WordPress.com refuses a write that needs approval with "Approval required."
// and the question for the user, then runs it again with user_confirmed.
export const wpcomApproval: McpApproval = {
	argument: 'user_confirmed',
	request( result ) {
		const [ refusal, prompt ] = result.split( WPCOM_PROMPT );
		if ( ! refusal.startsWith( 'Approval required.' ) || ! prompt ) {
			return undefined;
		}
		const [ question, ...details ] = prompt.split( '\n\n' );
		return {
			question,
			consequence: details.join( ' ' ) || 'Changes the live site.',
		};
	},
};

export async function readMcpServers(): Promise< McpServerSpec[] > {
	const servers: McpServerSpec[] = [];
	const token = await readAuthToken();
	if ( token ) {
		servers.push( {
			name: 'wpcom',
			url: WPCOM_MCP_URL,
			headers: { Authorization: `Bearer ${ token.accessToken }` },
			approval: wpcomApproval,
			builtIn: true,
		} );
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
const clients = new Map< string, Promise< Client > >();
const failedUntil = new Map< string, number >();

const serverKey = ( server: McpServerSpec ) =>
	JSON.stringify( [ server.name, server.url, server.headers, server.command ] );

// One connection per server for the life of the process; a failed one is
// dropped so a later turn connects again.
function connect( server: McpServerSpec ): Promise< Client > {
	const key = serverKey( server );
	let client = clients.get( key );
	if ( ! client ) {
		client = ( async () => {
			const [ { Client }, transport ] = await Promise.all( [
				import( '@modelcontextprotocol/sdk/client/index.js' ),
				createTransport( server ),
			] );
			const instance = new Client( { name: 'wordpress-studio', version: '1' } );
			await instance.connect( transport, { timeout: CONNECT_TIMEOUT_MS } );
			return instance;
		} )();
		client.catch( () => clients.delete( key ) );
		clients.set( key, client );
	}
	return client;
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
				const client = await connect( server );
				const { tools } = await client.listTools( undefined, { timeout: CONNECT_TIMEOUT_MS } );
				failedUntil.delete( key );
				return tools.map( ( tool ) => ( { server, client, tool } ) );
			} catch {
				failedUntil.set( key, Date.now() + RETRY_AFTER_MS );
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
				if ( declined ) {
					throw new Error( declined );
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
