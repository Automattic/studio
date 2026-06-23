// eslint-disable-next-line import-x/no-unresolved -- subpath resolved via package exports, which the lint resolver doesn't follow
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
// eslint-disable-next-line import-x/no-unresolved -- subpath resolved via package exports, which the lint resolver doesn't follow
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
// eslint-disable-next-line import-x/no-unresolved -- subpath resolved via package exports, which the lint resolver doesn't follow
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
// eslint-disable-next-line import-x/no-unresolved -- subpath resolved via package exports, which the lint resolver doesn't follow
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { readStudioCodeMcpConfig, type StudioCodeMcpServerConfig } from 'cli/ai/mcp-config';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { ToolContent } from 'cli/ai/tools/define-tool';

type McpClientTool = {
	name: string;
	label: string;
	description: string;
	parameters: unknown;
	execute: (
		toolCallId: string,
		params: Record< string, unknown >
	) => Promise< { content: ToolContent[]; details?: unknown } >;
};

type ConnectedMcpServer = {
	client: Client;
	transport: Transport;
};

function normalizeMcpToolName( serverName: string, toolName: string ): string {
	return `mcp__${ serverName }__${ toolName.replace( /[^a-zA-Z0-9_-]/g, '_' ) }`;
}

function buildRequestInit(
	headers: Record< string, string > | undefined
): RequestInit | undefined {
	return headers ? { headers } : undefined;
}

function buildStdioEnv( env: Record< string, string > | undefined ): Record< string, string > {
	const inherited = Object.fromEntries(
		Object.entries( process.env ).filter(
			( entry ): entry is [ string, string ] => typeof entry[ 1 ] === 'string'
		)
	);
	return { ...inherited, ...( env ?? {} ) };
}

function createTransport( server: StudioCodeMcpServerConfig ): Transport {
	if ( 'command' in server ) {
		return new StdioClientTransport( {
			command: server.command,
			args: server.args,
			env: buildStdioEnv( server.env ),
			cwd: process.cwd(),
			stderr: 'pipe',
		} );
	}

	if ( server.type === 'sse' ) {
		return new SSEClientTransport( new URL( server.url ), {
			requestInit: buildRequestInit( server.headers ),
			eventSourceInit: buildRequestInit( server.headers ) as never,
		} );
	}

	return new StreamableHTTPClientTransport( new URL( server.url ), {
		requestInit: buildRequestInit( server.headers ),
	} );
}

async function connectMcpServer(
	serverName: string,
	server: StudioCodeMcpServerConfig
): Promise< ConnectedMcpServer > {
	const client = new Client( { name: `studio-code-${ serverName }`, version: '1.0.0' }, {} );
	const transport = createTransport( server );
	try {
		await client.connect( transport );
		return { client, transport };
	} catch ( error ) {
		await transport.close().catch( () => {} );
		throw error;
	}
}

function toToolContent( content: unknown ): ToolContent[] {
	if ( ! Array.isArray( content ) ) {
		return [ { type: 'text', text: JSON.stringify( content ) } ];
	}

	return content.map( ( item ) => {
		if ( item && typeof item === 'object' ) {
			const block = item as Record< string, unknown >;
			if ( block.type === 'text' && typeof block.text === 'string' ) {
				return { type: 'text', text: block.text };
			}
			if (
				block.type === 'image' &&
				typeof block.data === 'string' &&
				typeof block.mimeType === 'string'
			) {
				return { type: 'image', data: block.data, mimeType: block.mimeType };
			}
		}

		return { type: 'text', text: JSON.stringify( item ) };
	} );
}

export async function resolveCustomMcpTools(): Promise< McpClientTool[] > {
	const config = await readStudioCodeMcpConfig();
	const tools: McpClientTool[] = [];

	for ( const [ serverName, server ] of Object.entries( config.mcpServers ) ) {
		const { client } = await connectMcpServer( serverName, server );
		const { tools: serverTools } = await client.listTools();

		for ( const tool of serverTools ) {
			const name = normalizeMcpToolName( serverName, tool.name );
			tools.push( {
				name,
				label: name,
				description:
					tool.description ?? `Tool ${ tool.name } from custom MCP server ${ serverName }`,
				parameters: tool.inputSchema,
				execute: async ( _toolCallId, params ) => {
					const result = await client.callTool( {
						name: tool.name,
						arguments: params,
					} );

					if ( 'toolResult' in result ) {
						return { content: [ { type: 'text', text: JSON.stringify( result.toolResult ) } ] };
					}

					return {
						content: toToolContent( result.content ),
						details: result.structuredContent
							? { structuredContent: result.structuredContent }
							: undefined,
					};
				},
			} );
		}
	}

	return tools;
}
