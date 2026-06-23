import fs from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	addStudioCodeMcpServer,
	getStudioCodeMcpConfigPath,
	readStudioCodeMcpConfig,
	removeStudioCodeMcpServer,
	saveStudioCodeMcpConfig,
} from 'cli/ai/mcp-config';

const { studioConfigRoot } = vi.hoisted( () => ( {
	studioConfigRoot: `${ process.env.TMPDIR || '/tmp/' }studio-code-mcp-config-${ Math.random()
		.toString( 36 )
		.slice( 2 ) }`,
} ) );

vi.mock( '@studio/common/lib/well-known-paths', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('@studio/common/lib/well-known-paths') >();
	return {
		...actual,
		getConfigDirectory: () => studioConfigRoot,
		getStudioCodeMcpConfigPath: () => `${ studioConfigRoot }/mcp.json`,
	};
} );

describe( 'Studio Code MCP config', () => {
	beforeEach( () => {
		fs.rmSync( getStudioCodeMcpConfigPath(), { force: true } );
	} );

	afterEach( () => {
		fs.rmSync( studioConfigRoot, { recursive: true, force: true } );
	} );

	it( 'returns an empty server list when no config file exists', async () => {
		await expect( readStudioCodeMcpConfig() ).resolves.toEqual( { mcpServers: {} } );
	} );

	it( 'reads stdio, http, and sse servers from config', async () => {
		const configPath = getStudioCodeMcpConfigPath();
		fs.mkdirSync( studioConfigRoot, { recursive: true } );
		fs.writeFileSync(
			configPath,
			JSON.stringify( {
				mcpServers: {
					wporg: {
						type: 'stdio',
						command: 'node',
						args: [ '/tmp/wporg.js' ],
						env: { GITHUB_TOKEN: 'token' },
					},
					figma: {
						type: 'http',
						url: 'https://mcp.figma.com/mcp',
						headers: { Authorization: 'Bearer token' },
					},
					legacy: {
						type: 'sse',
						url: 'https://example.com/sse',
					},
				},
			} )
		);

		await expect( readStudioCodeMcpConfig() ).resolves.toMatchObject( {
			mcpServers: {
				wporg: { type: 'stdio', command: 'node', args: [ '/tmp/wporg.js' ] },
				figma: { type: 'http', url: 'https://mcp.figma.com/mcp' },
				legacy: { type: 'sse', url: 'https://example.com/sse' },
			},
		} );
	} );

	it( 'preserves unknown top-level MCP config fields', async () => {
		await saveStudioCodeMcpConfig( {
			mcpServers: {
				wporg: { type: 'stdio', command: 'node' },
			},
			futureSdkField: true,
		} );

		await expect( readStudioCodeMcpConfig() ).resolves.toMatchObject( {
			mcpServers: {
				wporg: { type: 'stdio', command: 'node' },
			},
			futureSdkField: true,
		} );
	} );

	it( 'rejects the built-in studio server name', async () => {
		await expect(
			saveStudioCodeMcpConfig( {
				mcpServers: {
					studio: { type: 'stdio', command: 'node' },
				},
			} )
		).rejects.toThrow( 'reserved' );
	} );

	it( 'rejects unsafe server names', async () => {
		await expect(
			addStudioCodeMcpServer( 'bad name', { type: 'stdio', command: 'node' } )
		).rejects.toThrow( 'Invalid MCP server name' );
	} );

	it( 'adds and removes servers', async () => {
		await addStudioCodeMcpServer( 'wporg', {
			type: 'stdio',
			command: 'node',
			args: [ '/tmp/wporg.js' ],
		} );
		await expect( readStudioCodeMcpConfig() ).resolves.toMatchObject( {
			mcpServers: {
				wporg: { command: 'node', args: [ '/tmp/wporg.js' ] },
			},
		} );

		await expect( removeStudioCodeMcpServer( 'wporg' ) ).resolves.toBe( true );
		await expect( removeStudioCodeMcpServer( 'wporg' ) ).resolves.toBe( false );
		await expect( readStudioCodeMcpConfig() ).resolves.toEqual( { mcpServers: {} } );
	} );
} );
