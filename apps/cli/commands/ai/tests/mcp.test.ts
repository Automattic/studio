import fs from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import yargs from 'yargs/yargs';
import { getStudioCodeMcpConfigPath, readStudioCodeMcpConfig } from 'cli/ai/mcp-config';
import { registerCommand } from 'cli/commands/ai/mcp';
import { StudioArgv } from 'cli/types';

const { reportErrorMock, reportSuccessMock, reportWarningMock } = vi.hoisted( () => ( {
	reportErrorMock: vi.fn(),
	reportSuccessMock: vi.fn(),
	reportWarningMock: vi.fn(),
} ) );

vi.mock( 'cli/logger', () => ( {
	Logger: class {
		reportError = reportErrorMock;
		reportSuccess = reportSuccessMock;
		reportWarning = reportWarningMock;
	},
	LoggerError: class LoggerError extends Error {
		constructor( message: string, previousError?: unknown ) {
			super(
				previousError instanceof Error ? `${ message }: ${ previousError.message }` : message
			);
		}
	},
} ) );

const { studioSitesRoot } = vi.hoisted( () => ( {
	studioSitesRoot: `${ process.env.TMPDIR || '/tmp/' }studio-code-mcp-command-root-${ Math.random()
		.toString( 36 )
		.slice( 2 ) }`,
} ) );

vi.mock( 'cli/lib/site-paths', () => ( {
	STUDIO_SITES_ROOT: studioSitesRoot,
} ) );

describe( 'CLI: studio code mcp', () => {
	beforeEach( () => {
		vi.clearAllMocks();
		fs.rmSync( getStudioCodeMcpConfigPath(), { force: true } );
	} );

	afterEach( () => {
		fs.rmSync( studioSitesRoot, { recursive: true, force: true } );
	} );

	function buildParser(): StudioArgv {
		const parser = yargs( [] )
			.scriptName( 'studio code mcp' )
			.strict()
			.exitProcess( false ) as StudioArgv;
		registerCommand( parser );
		return parser;
	}

	it( 'adds a stdio server', async () => {
		await buildParser().parseAsync( [
			'add',
			'wporg',
			'--command',
			'node',
			'--arg',
			'/tmp/wporg.js',
			'--env',
			'GITHUB_TOKEN=test',
		] );

		await expect( readStudioCodeMcpConfig() ).resolves.toEqual( {
			mcpServers: {
				wporg: {
					type: 'stdio',
					command: 'node',
					args: [ '/tmp/wporg.js' ],
					env: { GITHUB_TOKEN: 'test' },
				},
			},
		} );
		expect( reportSuccessMock ).toHaveBeenCalledWith( 'Added custom MCP server "wporg".' );
	} );

	it( 'adds an http server', async () => {
		await buildParser().parseAsync( [
			'add',
			'figma',
			'--type',
			'http',
			'--url',
			'https://mcp.figma.com/mcp',
			'--header',
			'Authorization=Bearer test',
		] );

		await expect( readStudioCodeMcpConfig() ).resolves.toEqual( {
			mcpServers: {
				figma: {
					type: 'http',
					url: 'https://mcp.figma.com/mcp',
					headers: { Authorization: 'Bearer test' },
				},
			},
		} );
	} );

	it( 'reports invalid server definitions without throwing raw stacks', async () => {
		await buildParser().parseAsync( [ 'add', 'wporg' ] );
		await buildParser().parseAsync( [ 'add', 'wporg', '--command', 'node', '--env', 'broken' ] );
		await buildParser().parseAsync( [ 'add', 'studio', '--command', 'node' ] );

		expect( reportErrorMock ).toHaveBeenCalledTimes( 3 );
		expect( reportErrorMock.mock.calls[ 0 ][ 0 ].message ).toContain( '--command is required' );
		expect( reportErrorMock.mock.calls[ 1 ][ 0 ].message ).toContain( 'KEY=VALUE' );
		expect( reportErrorMock.mock.calls[ 2 ][ 0 ].message ).toContain( 'reserved' );
	} );

	it( 'lists configured servers', async () => {
		await buildParser().parseAsync( [
			'add',
			'wporg',
			'--command',
			'node',
			'--arg',
			'/tmp/wporg.js',
		] );
		vi.clearAllMocks();
		const output: string[] = [];
		const consoleSpy = vi
			.spyOn( console, 'log' )
			.mockImplementation( ( value ) => output.push( String( value ) ) );

		await buildParser().parseAsync( [ 'list' ] );

		expect( output ).toEqual( [ 'wporg\tnode /tmp/wporg.js' ] );
		consoleSpy.mockRestore();
	} );

	it( 'removes a configured server', async () => {
		await buildParser().parseAsync( [ 'add', 'wporg', '--command', 'node' ] );
		await buildParser().parseAsync( [ 'remove', 'wporg' ] );

		await expect( readStudioCodeMcpConfig() ).resolves.toEqual( { mcpServers: {} } );
		expect( reportSuccessMock ).toHaveBeenCalledWith( 'Removed custom MCP server "wporg".' );
	} );

	it( 'warns when removing an unknown server', async () => {
		await buildParser().parseAsync( [ 'remove', 'wporg' ] );

		expect( reportWarningMock ).toHaveBeenCalledWith( 'No custom MCP server named "wporg".' );
	} );

	it( 'prints the config path', async () => {
		const output: string[] = [];
		const consoleSpy = vi
			.spyOn( console, 'log' )
			.mockImplementation( ( value ) => output.push( String( value ) ) );

		await buildParser().parseAsync( [ 'path' ] );

		expect( output ).toEqual( [ getStudioCodeMcpConfigPath() ] );
		consoleSpy.mockRestore();
	} );
} );
