import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { __ } from '@wordpress/i18n';
import { StudioArgv } from 'cli/types';
import { registerAuthTools } from './tools/auth';
import { registerFsTools } from './tools/files';
import { registerPreviewTools } from './tools/preview';
import { registerSiteTools } from './tools/sites';
import { registerWpCliTool } from './tools/wp-cli';

export const registerCommand = ( yargs: StudioArgv ) =>
	yargs.command( {
		command: 'mcp',
		describe: __( 'Start MCP server (JSON-RPC over stdio)' ),
		builder: ( y ) => y.version( false ),
		handler: async () => {
			const server = new McpServer( {
				name: 'studio',
				version: __STUDIO_CLI_VERSION__,
			} );

			registerSiteTools( server );
			registerFsTools( server );
			registerWpCliTool( server );
			registerPreviewTools( server );
			registerAuthTools( server );

			const transport = new StdioServerTransport();
			await server.connect( transport );

			// server.connect() returns immediately; keep the process alive until
			// the client closes the connection.
			await new Promise< void >( ( resolve ) => {
				transport.onclose = resolve;
			} );
		},
	} );
