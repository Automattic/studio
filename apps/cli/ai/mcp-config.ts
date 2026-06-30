import fs from 'fs';
import path from 'path';
import { getStudioCodeMcpConfigPath } from '@studio/common/lib/well-known-paths';
import { readFile, writeFile } from 'atomically';
import { z } from 'zod';

const RESERVED_SERVER_NAMES = new Set( [ 'studio' ] );
const SERVER_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

const stringRecordSchema = z.record( z.string(), z.string() );

const stdioServerSchema = z
	.object( {
		type: z.literal( 'stdio' ).optional(),
		command: z.string().trim().min( 1 ),
		args: z.array( z.string() ).optional(),
		env: stringRecordSchema.optional(),
	} )
	.strict();

const httpServerSchema = z
	.object( {
		type: z.literal( 'http' ),
		url: z.string().trim().url(),
		headers: stringRecordSchema.optional(),
	} )
	.strict();

const sseServerSchema = z
	.object( {
		type: z.literal( 'sse' ),
		url: z.string().trim().url(),
		headers: stringRecordSchema.optional(),
	} )
	.strict();

const serverSchema = z.union( [ stdioServerSchema, httpServerSchema, sseServerSchema ] );

const configSchema = z
	.object( {
		mcpServers: z.record( z.string(), serverSchema ).default( {} ),
	} )
	.passthrough();

export type StudioCodeMcpServerConfig = z.infer< typeof serverSchema >;
export type StudioCodeMcpConfig = z.infer< typeof configSchema >;

export { getStudioCodeMcpConfigPath };

function validateServerName( name: string ): void {
	if ( ! SERVER_NAME_PATTERN.test( name ) ) {
		throw new Error(
			`Invalid MCP server name "${ name }". Use only letters, numbers, underscores, and hyphens.`
		);
	}

	if ( RESERVED_SERVER_NAMES.has( name ) ) {
		throw new Error(
			`Invalid MCP server name "${ name }". This name is reserved for Studio's built-in MCP server.`
		);
	}
}

function parseStudioCodeMcpConfig( data: unknown ): StudioCodeMcpConfig {
	const config = configSchema.parse( data );
	for ( const name of Object.keys( config.mcpServers ) ) {
		validateServerName( name );
	}
	return config;
}

export async function readStudioCodeMcpConfig(): Promise< StudioCodeMcpConfig > {
	const configPath = getStudioCodeMcpConfigPath();

	if ( ! fs.existsSync( configPath ) ) {
		return { mcpServers: {} };
	}

	try {
		const fileContent = await readFile( configPath, { encoding: 'utf8' } );
		return parseStudioCodeMcpConfig( JSON.parse( fileContent ) );
	} catch ( error ) {
		if ( error instanceof z.ZodError ) {
			throw new Error( `Invalid Studio Code MCP config at ${ configPath }: ${ error.message }` );
		}
		if ( error instanceof SyntaxError ) {
			throw new Error( `Studio Code MCP config at ${ configPath } is not valid JSON.` );
		}
		throw error;
	}
}

export async function saveStudioCodeMcpConfig( config: StudioCodeMcpConfig ): Promise< void > {
	const validatedConfig = parseStudioCodeMcpConfig( config );
	const configDirectory = path.dirname( getStudioCodeMcpConfigPath() );
	if ( ! fs.existsSync( configDirectory ) ) {
		fs.mkdirSync( configDirectory, { recursive: true } );
	}

	await writeFile(
		getStudioCodeMcpConfigPath(),
		JSON.stringify( validatedConfig, null, 2 ) + '\n',
		{ encoding: 'utf8' }
	);
}

export async function addStudioCodeMcpServer(
	name: string,
	server: StudioCodeMcpServerConfig
): Promise< void > {
	validateServerName( name );
	const config = await readStudioCodeMcpConfig();
	config.mcpServers[ name ] = server;
	await saveStudioCodeMcpConfig( config );
}

export async function removeStudioCodeMcpServer( name: string ): Promise< boolean > {
	validateServerName( name );
	const config = await readStudioCodeMcpConfig();
	if ( ! config.mcpServers[ name ] ) {
		return false;
	}
	delete config.mcpServers[ name ];
	await saveStudioCodeMcpConfig( config );
	return true;
}
