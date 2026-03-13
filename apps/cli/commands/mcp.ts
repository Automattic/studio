import { getMcpServerConfigJson } from '@studio/common/lib/mcp-config';
import { __ } from '@wordpress/i18n';
import { startMcpStdioServer } from 'cli/ai/mcp-server';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< string >();

function printInstallationInstructions(): void {
	const config = getMcpServerConfigJson();

	const lines = [
		'',
		__( 'WordPress Studio MCP Server' ),
		'─'.repeat( 40 ),
		'',
		__( "Add the following to your AI assistant's MCP configuration:" ),
		'',
		'{',
		'  "mcpServers": ' +
			config
				.split( '\n' )
				.map( ( line, i ) => ( i === 0 ? line : '  ' + line ) )
				.join( '\n' ),
		'}',
		'',
		__( 'Configuration file locations:' ),
		'',
		'  Claude Desktop',
		'    macOS  ~/Library/Application\\ Support/Claude/claude_desktop_config.json',
		'    Win    %APPDATA%\\Claude\\claude_desktop_config.json',
		'',
	];

	for ( const line of lines ) {
		console.log( line );
	}
}

export async function runCommand(): Promise< void > {
	if ( process.stdin.isTTY && process.stdout.isTTY ) {
		printInstallationInstructions();
		return;
	}

	await startMcpStdioServer();
}

export const registerCommand = ( yargs: StudioArgv ) => {
	return yargs.command( {
		command: 'mcp',
		describe: __( 'MCP server for AI assistants' ),
		builder: ( yargs ) => {
			return yargs.help( false ).option( 'help', { type: 'boolean' } );
		},
		handler: async ( argv ) => {
			if ( argv.help ) {
				printInstallationInstructions();
				return;
			}
			try {
				await runCommand();
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
