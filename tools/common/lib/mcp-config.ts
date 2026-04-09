/**
 * Generates the MCP server configuration block that users add to their
 * AI assistant's settings. Shared between the CLI `studio mcp` command
 * and the Studio desktop Settings dialog.
 */
type McpServerConfig = {
	command: string;
	args: string[];
};

export const MCP_SERVER_NAME = 'wordpress-studio';

export function getMcpServerLaunchCommand(): string {
	const serverConfig = getMcpServerConfig()[ MCP_SERVER_NAME ];

	return [ serverConfig.command, ...serverConfig.args ].join( ' ' );
}

export function getMcpServerConfig(): Record< string, McpServerConfig > {
	return {
		[ MCP_SERVER_NAME ]: {
			command: 'studio',
			args: [ 'mcp' ],
		},
	};
}

export function getMcpServerConfigJson(): string {
	return JSON.stringify( getMcpServerConfig(), null, 2 );
}
