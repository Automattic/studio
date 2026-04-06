import {
	getMcpServerConfigJson,
	getMcpServerLaunchCommand,
	MCP_SERVER_NAME,
} from '@studio/common/lib/mcp-config';
import { __ } from '@wordpress/i18n';
import { startMcpStdioServer } from 'cli/ai/mcp-server';
import { MCP_TELEMETRY_GROUPS, type McpTelemetryGroup } from 'cli/lib/types/bump-stats';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< string >();

function getClaudeDesktopConfigPath(): string {
	switch ( process.platform ) {
		case 'darwin':
			return '~/Library/Application Support/Claude/claude_desktop_config.json';
		case 'win32':
			return '%APPDATA%\\Claude\\claude_desktop_config.json';
		default:
			return '';
	}
}

function printInstallationInstructions(): void {
	const mcpServersConfig = getMcpServerConfigJson();
	const launchCommand = getMcpServerLaunchCommand();
	const claudeDesktopPath = getClaudeDesktopConfigPath();

	const lines = [
		'',
		__( 'WordPress Studio MCP Server' ),
		'─'.repeat( 40 ),
		'',
		__( 'Run one of the following commands to add MCP support to your AI assistant:' ),
		'',
		`  ${ __( 'Claude Code' ) }`,
		`    claude mcp add --scope user ${ MCP_SERVER_NAME } -- ${ launchCommand }`,
		'',
		`  ${ __( 'Codex' ) }`,
		`    codex mcp add ${ MCP_SERVER_NAME } -- ${ launchCommand }`,
		'',
		__(
			'For other AI assistants, add the following under the "mcpServers" key in their MCP configuration:'
		),
		'',
		mcpServersConfig,
		'',
		__( 'Configuration file locations:' ),
		'',
		`  ${ __( 'Claude Desktop' ) }`,
		`    ${ claudeDesktopPath }`,
		'',
		`  ${ __( 'Cursor' ) }`,
		`    ${ __( 'Project' ) }  .cursor/mcp.json`,
		`    ${ __( 'Global' ) }   ~/.cursor/mcp.json`,
		'',
		__( 'For other AI assistants, check their documentation for config file locations.' ),
		'',
	];

	for ( const line of lines ) {
		console.log( line );
	}
}

type McpCommandOptions = {
	telemetryGroup?: McpTelemetryGroup;
};

export async function runCommand( options: McpCommandOptions = {} ): Promise< void > {
	if ( process.stdin.isTTY && process.stdout.isTTY ) {
		printInstallationInstructions();
		return;
	}

	await startMcpStdioServer( options );
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'mcp',
		describe: __( 'MCP server for AI assistants' ),
		builder: ( yargs ) => {
			return yargs
				.help( false )
				.option( 'help', { type: 'boolean' } )
				.option( 'telemetry-group', {
					type: 'string',
					hidden: true,
					choices: [ ...MCP_TELEMETRY_GROUPS ],
				} );
		},
		handler: async ( argv ) => {
			if ( argv.help ) {
				printInstallationInstructions();
				return;
			}
			try {
				await runCommand( { telemetryGroup: argv.telemetryGroup as McpTelemetryGroup | undefined } );
			} catch ( error ) {
				if ( error instanceof LoggerError ) {
					logger.reportError( error );
				} else {
					const loggerError = new LoggerError( __( 'MCP server failed' ), error );
					logger.reportError( loggerError );
				}
			}
		},
	} );
};
