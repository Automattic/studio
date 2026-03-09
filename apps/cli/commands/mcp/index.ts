import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { __ } from '@wordpress/i18n';
import { StudioArgv } from 'cli/types';
import { registerAuthTools } from './tools/auth';
import { registerFsTools } from './tools/files';
import { registerPreviewTools } from './tools/preview';
import { registerSiteTools } from './tools/sites';
import { registerWpCliTool } from './tools/wp-cli';

function printInstallInstructions() {
	console.log(
		[
			__( 'Studio MCP Server' ),
			'',
			__(
				'Connects Claude Desktop, Claude Code, or any MCP-compatible AI app to your local WordPress sites.'
			),
			'',
			__( 'Available tools: site_list, site_start, site_stop, site_create, site_delete,' ),
			__( '  site_status, site_set, fs_list_dir, fs_read_file, fs_write_file, fs_delete,' ),
			__( '  wp, preview_list, preview_create, auth_status' ),
			'',
			__( 'Setup:' ),
			'',
			__( '  Claude Code:' ),
			'    claude mcp add studio -- studio mcp',
			'',
			__( '  Claude Desktop (add to claude_desktop_config.json):' ),
			'    {',
			'      "mcpServers": {',
			'        "studio": { "command": "studio", "args": ["mcp"] }',
			'      }',
			'    }',
			'',
			__( 'This command is intended to be run by an MCP client, not directly in a terminal.' ),
		].join( '\n' )
	);
}

export const registerCommand = ( yargs: StudioArgv ) =>
	yargs.command( {
		command: 'mcp',
		describe: __( 'Use Studio sites and tools from Claude or other AI apps' ),
		builder: ( y ) => y.version( false ),
		handler: async () => {
			if ( process.stdin.isTTY ) {
				printInstallInstructions();
				return;
			}

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
