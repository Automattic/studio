import fs from 'fs';
import path from 'path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { startAiAgent } from 'cli/ai/agent';
import { STUDIO_SITES_ROOT } from 'cli/lib/site-paths';

vi.mock( '@anthropic-ai/claude-agent-sdk', () => ( {
	query: vi.fn(),
} ) );

vi.mock( 'cli/ai/system-prompt', () => ( {
	buildSystemPrompt: vi.fn().mockReturnValue( 'test system prompt' ),
} ) );

vi.mock( 'cli/ai/tools', () => ( {
	createRemoteSiteTools: vi.fn().mockReturnValue( { type: 'remote-tools' } ),
	createStudioTools: vi.fn().mockReturnValue( { type: 'local-tools' } ),
} ) );

/**
 * Resolve the absolute path for the DLA tree based on the agent module's
 * runtime directory. Mirrors the `path.resolve( import.meta.dirname, 'dla' )`
 * call in `agent.ts` so test assertions match the production lookup.
 */
const DLA_PATH = path.resolve( import.meta.dirname, '..', 'dla' );

describe( 'AI agent startup', () => {
	const mockQuery = {
		interrupt: vi.fn(),
		[ Symbol.asyncIterator ]() {
			return {
				next: async () => ( {
					done: true as const,
					value: undefined,
				} ),
			};
		},
	};
	let existsSyncSpy: MockInstance;
	let mkdirSyncSpy: MockInstance;

	beforeEach( () => {
		vi.resetAllMocks();
		existsSyncSpy = vi.spyOn( fs, 'existsSync' ).mockReturnValue( true );
		mkdirSyncSpy = vi.spyOn( fs, 'mkdirSync' ).mockReturnValue( undefined );
		vi.mocked( query ).mockReturnValue( mockQuery as never );
	} );

	it( 'creates the Studio root before starting the agent when it is missing', () => {
		existsSyncSpy.mockImplementation( ( p: fs.PathLike ) => {
			if ( p === STUDIO_SITES_ROOT ) {
				return false;
			}
			return true;
		} );

		const result = startAiAgent( {
			prompt: 'Generate a website',
		} );

		expect( existsSyncSpy ).toHaveBeenCalledWith( STUDIO_SITES_ROOT );
		expect( mkdirSyncSpy ).toHaveBeenCalledWith( STUDIO_SITES_ROOT, { recursive: true } );
		expect( query ).toHaveBeenCalledWith(
			expect.objectContaining( {
				prompt: 'Generate a website',
				options: expect.objectContaining( {
					cwd: STUDIO_SITES_ROOT,
				} ),
			} )
		);
		expect( result ).toBe( mockQuery );
	} );

	it( 'does not recreate the Studio root when it already exists', () => {
		const result = startAiAgent( {
			prompt: 'Generate a website',
		} );

		expect( existsSyncSpy ).toHaveBeenCalledWith( STUDIO_SITES_ROOT );
		expect( mkdirSyncSpy ).not.toHaveBeenCalled();
		expect( query ).toHaveBeenCalledWith(
			expect.objectContaining( {
				prompt: 'Generate a website',
				options: expect.objectContaining( {
					cwd: STUDIO_SITES_ROOT,
				} ),
			} )
		);
		expect( result ).toBe( mockQuery );
	} );

	describe( 'DLA registration', () => {
		it( 'registers data-liberation MCP server when dla/ dir exists', () => {
			existsSyncSpy.mockReturnValue( true );

			startAiAgent( {
				prompt: 'Migrate a site',
				env: { CUSTOM_ENV: 'value' },
			} );

			const callArgs = vi.mocked( query ).mock.calls[ 0 ][ 0 ];
			const mcpServers = callArgs.options?.mcpServers as Record< string, unknown >;
			expect( mcpServers ).toHaveProperty( 'data-liberation' );
			const dla = mcpServers[ 'data-liberation' ] as {
				type: string;
				command: string;
				args: string[];
				env: Record< string, string >;
			};
			expect( dla.type ).toBe( 'stdio' );
			expect( dla.command ).toBe( process.execPath );
			// The MCP server path must be absolute so DLA's `import.meta.url`
			// peer lookups work without depending on a working directory —
			// the Anthropic Agent SDK's `McpStdioServerConfig` does not
			// accept a `cwd` field for stdio MCP children.
			expect( dla.args ).toEqual( [ path.join( DLA_PATH, 'src/mcp-server.js' ) ] );
			expect( path.isAbsolute( dla.args[ 0 ] ) ).toBe( true );
			expect( dla ).not.toHaveProperty( 'cwd' );
			expect( dla.env.CUSTOM_ENV ).toBe( 'value' );
			expect( dla.env ).toHaveProperty( 'STUDIO_WPCOM_TOKEN' );
		} );

		it( 'does not register data-liberation MCP server when dla/ dir is missing', () => {
			existsSyncSpy.mockImplementation( ( p: fs.PathLike ) => {
				if ( typeof p === 'string' && p === DLA_PATH ) {
					return false;
				}
				return true;
			} );

			startAiAgent( {
				prompt: 'Migrate a site',
			} );

			const callArgs = vi.mocked( query ).mock.calls[ 0 ][ 0 ];
			const mcpServers = callArgs.options?.mcpServers as Record< string, unknown >;
			expect( mcpServers ).not.toHaveProperty( 'data-liberation' );
			const plugins = callArgs.options?.plugins as unknown[];
			expect( plugins ).toHaveLength( 1 );
		} );

		it( 'includes the DLA plugin in plugins when dla/ dir exists', () => {
			existsSyncSpy.mockReturnValue( true );

			startAiAgent( { prompt: 'Migrate a site' } );

			const callArgs = vi.mocked( query ).mock.calls[ 0 ][ 0 ];
			const plugins = callArgs.options?.plugins as Array< { type: string; path: string } >;
			expect( plugins ).toHaveLength( 2 );
			expect( plugins[ 1 ] ).toEqual( {
				type: 'local',
				path: DLA_PATH,
			} );
		} );

		it( 'passes wpcomAccessToken into data-liberation env when provided', () => {
			existsSyncSpy.mockReturnValue( true );

			startAiAgent( {
				prompt: 'Migrate a site',
				wpcomAccessToken: 'secret-token-123',
			} );

			const callArgs = vi.mocked( query ).mock.calls[ 0 ][ 0 ];
			const mcpServers = callArgs.options?.mcpServers as Record< string, unknown >;
			const dla = mcpServers[ 'data-liberation' ] as {
				env: Record< string, string >;
			};
			expect( dla.env.STUDIO_WPCOM_TOKEN ).toBe( 'secret-token-123' );
		} );

		it( 'falls back to empty STUDIO_WPCOM_TOKEN when no token is provided', () => {
			existsSyncSpy.mockReturnValue( true );

			startAiAgent( { prompt: 'Migrate a site' } );

			const callArgs = vi.mocked( query ).mock.calls[ 0 ][ 0 ];
			const mcpServers = callArgs.options?.mcpServers as Record< string, unknown >;
			const dla = mcpServers[ 'data-liberation' ] as {
				env: Record< string, string >;
			};
			expect( dla.env.STUDIO_WPCOM_TOKEN ).toBe( '' );
		} );

		it( 'registers a canUseTool callback when DLA is available', () => {
			existsSyncSpy.mockReturnValue( true );

			startAiAgent( { prompt: 'Migrate a site' } );

			const callArgs = vi.mocked( query ).mock.calls[ 0 ][ 0 ];
			expect( callArgs.options?.canUseTool ).toBeTypeOf( 'function' );
		} );

		it( 'does not register a canUseTool callback when DLA is missing', () => {
			existsSyncSpy.mockImplementation( ( p: fs.PathLike ) => {
				if ( typeof p === 'string' && p === DLA_PATH ) {
					return false;
				}
				return true;
			} );

			startAiAgent( { prompt: 'Migrate a site' } );

			const callArgs = vi.mocked( query ).mock.calls[ 0 ][ 0 ];
			expect( callArgs.options?.canUseTool ).toBeUndefined();
		} );
	} );
} );
