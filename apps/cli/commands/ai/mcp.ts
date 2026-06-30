import { __, sprintf } from '@wordpress/i18n';
import {
	addStudioCodeMcpServer,
	getStudioCodeMcpConfigPath,
	readStudioCodeMcpConfig,
	removeStudioCodeMcpServer,
	type StudioCodeMcpServerConfig,
} from 'cli/ai/mcp-config';
import { Logger, LoggerError } from 'cli/logger';
import { StudioArgv } from 'cli/types';

const logger = new Logger< string >();

function parseKeyValuePairs(
	pairs: string[] | undefined,
	optionName: string
): Record< string, string > | undefined {
	if ( ! pairs?.length ) {
		return undefined;
	}

	const parsed: Record< string, string > = {};
	for ( const pair of pairs ) {
		const separatorIndex = pair.indexOf( '=' );
		if ( separatorIndex <= 0 ) {
			throw new Error( sprintf( __( '%s entries must use KEY=VALUE format.' ), optionName ) );
		}
		parsed[ pair.slice( 0, separatorIndex ) ] = pair.slice( separatorIndex + 1 );
	}
	return parsed;
}

function buildServerConfig( argv: {
	type?: string;
	command?: string;
	arg?: string[];
	url?: string;
	env?: string[];
	header?: string[];
} ): StudioCodeMcpServerConfig {
	const type = argv.type ?? ( argv.url ? 'http' : 'stdio' );

	if ( type === 'stdio' ) {
		if ( ! argv.command ) {
			throw new Error( __( '--command is required for stdio MCP servers.' ) );
		}
		return {
			type: 'stdio',
			command: argv.command,
			args: argv.arg,
			env: parseKeyValuePairs( argv.env, '--env' ),
		};
	}

	if ( type === 'http' || type === 'sse' ) {
		if ( ! argv.url ) {
			throw new Error( __( '--url is required for HTTP and SSE MCP servers.' ) );
		}
		return {
			type,
			url: argv.url,
			headers: parseKeyValuePairs( argv.header, '--header' ),
		};
	}

	throw new Error( __( '--type must be one of: stdio, http, sse.' ) );
}

export const registerCommand = ( yargs: StudioArgv ) => {
	yargs.command( {
		command: 'list',
		describe: __( 'List custom MCP servers' ),
		handler: async () => {
			const config = await readStudioCodeMcpConfig();
			const entries = Object.entries( config.mcpServers );
			if ( entries.length === 0 ) {
				logger.reportSuccess( __( 'No custom MCP servers configured.' ) );
				return;
			}
			for ( const [ name, server ] of entries ) {
				if ( 'command' in server ) {
					console.log( `${ name }\t${ [ server.command, ...( server.args ?? [] ) ].join( ' ' ) }` );
				} else {
					console.log( `${ name }\t${ server.type }: ${ server.url }` );
				}
			}
		},
	} );

	yargs.command( {
		command: 'add <name>',
		describe: __( 'Add or replace a custom MCP server' ),
		builder: ( addYargs ) =>
			addYargs
				.positional( 'name', {
					type: 'string',
					description: __( 'MCP server name' ),
					demandOption: true,
				} )
				.option( 'type', {
					type: 'string',
					choices: [ 'stdio', 'http', 'sse' ] as const,
					description: __( 'MCP server transport type' ),
				} )
				.option( 'command', {
					type: 'string',
					description: __( 'Command for stdio MCP servers' ),
				} )
				.option( 'arg', {
					type: 'string',
					array: true,
					description: __( 'Argument for stdio MCP servers; repeat for multiple arguments' ),
				} )
				.option( 'url', {
					type: 'string',
					description: __( 'URL for HTTP or SSE MCP servers' ),
				} )
				.option( 'env', {
					type: 'string',
					array: true,
					description: __( 'Environment variable for stdio servers in KEY=VALUE format' ),
				} )
				.option( 'header', {
					type: 'string',
					array: true,
					description: __( 'Header for HTTP or SSE servers in KEY=VALUE format' ),
				} ),
		handler: async ( argv ) => {
			try {
				const typedArgv = argv as {
					name: string;
					type?: string;
					command?: string;
					arg?: string[];
					url?: string;
					env?: string[];
					header?: string[];
				};
				const server = buildServerConfig( typedArgv );
				await addStudioCodeMcpServer( typedArgv.name, server );
				logger.reportSuccess( sprintf( __( 'Added custom MCP server "%s".' ), typedArgv.name ) );
			} catch ( error ) {
				logger.reportError( new LoggerError( __( 'Failed to add custom MCP server' ), error ) );
			}
		},
	} );

	yargs.command( {
		command: 'remove <name>',
		describe: __( 'Remove a custom MCP server' ),
		builder: ( removeYargs ) =>
			removeYargs.positional( 'name', {
				type: 'string',
				description: __( 'MCP server name' ),
				demandOption: true,
			} ),
		handler: async ( argv ) => {
			const name = ( argv as { name: string } ).name;
			const removed = await removeStudioCodeMcpServer( name );
			if ( removed ) {
				logger.reportSuccess( sprintf( __( 'Removed custom MCP server "%s".' ), name ) );
				return;
			}
			logger.reportWarning( sprintf( __( 'No custom MCP server named "%s".' ), name ) );
		},
	} );

	yargs.command( {
		command: 'path',
		describe: __( 'Print the custom MCP config path' ),
		handler: () => {
			console.log( getStudioCodeMcpConfigPath() );
		},
	} );

	return yargs
		.version( false )
		.demandCommand( 1, __( 'You must provide a valid code mcp command' ) );
};
