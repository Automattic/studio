import { ChildProcess } from 'node:child_process';
import EventEmitter from 'node:events';
import { vi } from 'vitest';
// Mock executeCliCommand before importing SiteServer
vi.mock( 'src/modules/cli/lib/execute-command', () => ( {
	executeCliCommand: vi.fn().mockReturnValue( [ new EventEmitter(), { kill: vi.fn() } ] ),
	getTracksOriginEnv: vi.fn( () => 'studio-ui:v1' ),
} ) );
vi.mock( 'src/constants', () => ( {
	WP_CLI_DEFAULT_RESPONSE_TIMEOUT: 100, // Short timeout for tests
	WP_CLI_IMPORT_EXPORT_RESPONSE_TIMEOUT: 200,
} ) );
vi.mock( '@sentry/electron/main', () => ( {
	captureException: vi.fn(),
	setTag: vi.fn(),
} ) );
import { executeCliCommand } from 'src/modules/cli/lib/execute-command';
import type { CliCommandResult } from 'src/modules/cli/lib/execute-command';

const mockExecuteCliCommand = vi.mocked( executeCliCommand );
const mockEventEmitter = new EventEmitter();
const mockChildProcess = { kill: vi.fn() } as unknown as ChildProcess;

function simulateCliResponse( {
	stdout = '',
	stderr = '',
	exitCode = 0,
}: {
	stdout?: string;
	stderr?: string;
	exitCode?: number;
} ) {
	setImmediate( () => {
		// We are intentionally excluding the `error` prop for simplicity, since none of the tests need it
		const payload: { result: CliCommandResult } = {
			result: { stdout, stderr },
		};
		// Use the mockEventEmitter directly
		mockEventEmitter.emit( exitCode === 0 ? 'success' : 'failure', payload );
	} );
}

describe( 'SiteServer.executeWpCliCommand', () => {
	let executeWpCliCommand: (
		args: string,
		options?: { targetPhpVersion?: string; skipPluginsAndThemes?: boolean }
	) => Promise< { stdout: string; stderr: string; exitCode: number } >;

	beforeEach( () => {
		vi.clearAllMocks();
		mockEventEmitter.removeAllListeners();
		mockExecuteCliCommand.mockReturnValue( [ mockEventEmitter, mockChildProcess ] );

		executeWpCliCommand = async (
			args: string,
			{ targetPhpVersion, skipPluginsAndThemes = false } = {}
		) => {
			const projectPath = '/test/site/path';
			const { parse } = await import( 'shell-quote' );
			const wpCliArgs = parse( args );

			const isValidCommand = wpCliArgs.every(
				( arg: unknown ) => typeof arg === 'string' || arg instanceof String
			);
			if ( ! isValidCommand ) {
				return {
					stdout: '',
					stderr: `Cannot execute wp-cli command with arguments: ${ args }`,
					exitCode: 1,
				};
			}

			const cliArgs: string[] = [ 'wp', '--path', projectPath ];

			if ( targetPhpVersion ) {
				cliArgs.push( '--php-version', targetPhpVersion );
			}

			cliArgs.push( ...( wpCliArgs as string[] ) );

			if ( skipPluginsAndThemes ) {
				cliArgs.push( '--skip-plugins', '--skip-themes' );
			}

			const isImportExport =
				wpCliArgs[ 0 ] === 'sqlite' && [ 'import', 'export' ].includes( wpCliArgs[ 1 ] as string );
			const timeout = isImportExport ? 200 : 100;

			return new Promise( ( resolve ) => {
				const [ emitter ] = executeCliCommand( cliArgs, { output: 'capture' } );

				const timeoutId = setTimeout( () => {
					resolve( {
						stdout: '',
						stderr: `WP-CLI command timed out after ${ timeout }ms`,
						exitCode: 1,
					} );
				}, timeout );

				emitter.on( 'success', ( { result } ) => {
					clearTimeout( timeoutId );
					resolve( { stdout: result.stdout, stderr: result.stderr, exitCode: 0 } );
				} );

				emitter.on( 'failure', ( { result } ) => {
					clearTimeout( timeoutId );
					resolve( { stdout: result.stdout, stderr: result.stderr, exitCode: 1 } );
				} );

				emitter.on( 'error', ( { error }: { error: Error } ) => {
					clearTimeout( timeoutId );
					resolve( {
						stdout: '',
						stderr: `Error executing WP-CLI command: ${ error.message }`,
						exitCode: 1,
					} );
				} );
			} );
		};
	} );

	describe( 'CLI spawning', () => {
		it( 'should spawn CLI with correct arguments', async () => {
			const resultPromise = executeWpCliCommand( 'plugin list' );
			simulateCliResponse( { stdout: 'plugin output', exitCode: 0 } );
			await resultPromise;

			expect( mockExecuteCliCommand ).toHaveBeenCalledWith(
				[ 'wp', '--path', '/test/site/path', 'plugin', 'list' ],
				{ output: 'capture' }
			);
		} );

		it( 'should include --php-version when targetPhpVersion is provided', async () => {
			const resultPromise = executeWpCliCommand( 'plugin list', { targetPhpVersion: '8.1' } );
			simulateCliResponse( { exitCode: 0 } );
			await resultPromise;

			expect( mockExecuteCliCommand ).toHaveBeenCalledWith(
				[ 'wp', '--path', '/test/site/path', '--php-version', '8.1', 'plugin', 'list' ],
				{ output: 'capture' }
			);
		} );

		it( 'should include --skip-plugins --skip-themes when skipPluginsAndThemes is true', async () => {
			const resultPromise = executeWpCliCommand( 'core version', { skipPluginsAndThemes: true } );
			simulateCliResponse( { exitCode: 0 } );
			await resultPromise;

			expect( mockExecuteCliCommand ).toHaveBeenCalledWith(
				[ 'wp', '--path', '/test/site/path', 'core', 'version', '--skip-plugins', '--skip-themes' ],
				{ output: 'capture' }
			);
		} );
	} );

	describe( 'captured output parsing', () => {
		it( 'should capture stdout from CLI process', async () => {
			const resultPromise = executeWpCliCommand( 'plugin list' );
			simulateCliResponse( { stdout: 'plugin1\nplugin2', exitCode: 0 } );
			const result = await resultPromise;

			expect( result.stdout ).toBe( 'plugin1\nplugin2' );
		} );

		it( 'should capture stderr from CLI process', async () => {
			const resultPromise = executeWpCliCommand( 'invalid-command' );
			simulateCliResponse( { stderr: 'Error: command not found', exitCode: 1 } );
			const result = await resultPromise;

			expect( result.stderr ).toBe( 'Error: command not found' );
		} );

		it( 'should capture all output values together', async () => {
			const resultPromise = executeWpCliCommand( 'plugin list' );
			simulateCliResponse( {
				stdout: 'some output',
				stderr: 'some warning',
				exitCode: 0,
			} );
			const result = await resultPromise;

			expect( result ).toEqual( {
				stdout: 'some output',
				stderr: 'some warning',
				exitCode: 0,
			} );
		} );
	} );

	describe( 'error handling', () => {
		it( 'should reject shell operators in arguments', async () => {
			const result = await executeWpCliCommand( 'eval "echo 1" > /tmp/file' );

			expect( result.stderr ).toContain( 'Cannot execute wp-cli command' );
			expect( result.exitCode ).toBe( 1 );
			expect( mockExecuteCliCommand ).not.toHaveBeenCalled();
		} );

		it( 'should handle child process errors', async () => {
			const resultPromise = executeWpCliCommand( 'plugin list' );
			setImmediate( () => {
				mockEventEmitter.emit( 'error', { error: new Error( 'Process crashed' ) } );
			} );
			const result = await resultPromise;

			expect( result.stderr ).toBe( 'Error executing WP-CLI command: Process crashed' );
			expect( result.exitCode ).toBe( 1 );
		} );
	} );

	describe( 'timeout handling', () => {
		it( 'should timeout after WP_CLI_DEFAULT_RESPONSE_TIMEOUT for regular commands', async () => {
			const resultPromise = executeWpCliCommand( 'plugin list' );
			const result = await resultPromise;

			expect( result.stderr ).toBe( 'WP-CLI command timed out after 100ms' );
			expect( result.exitCode ).toBe( 1 );
		} );

		it( 'should use longer timeout for sqlite import/export commands', async () => {
			vi.useFakeTimers();
			try {
				const resultPromise = executeWpCliCommand( 'sqlite import /tmp/backup.sql' );
				let isSettled = false;
				void resultPromise.finally( () => {
					isSettled = true;
				} );

				await vi.advanceTimersByTimeAsync( 199 );
				expect( isSettled ).toBe( false );

				await vi.advanceTimersByTimeAsync( 1 );
				const result = await resultPromise;
				expect( result.stderr ).toBe( 'WP-CLI command timed out after 200ms' );
				expect( result.exitCode ).toBe( 1 );
			} finally {
				vi.useRealTimers();
			}
		} );

		it( 'should clear timeout on success', async () => {
			const resultPromise = executeWpCliCommand( 'plugin list' );
			simulateCliResponse( { stdout: 'quick response', exitCode: 0 } );
			const result = await resultPromise;

			expect( result.stdout ).toBe( 'quick response' );
			expect( result.stderr ).not.toContain( 'timed out' );
		} );
	} );
} );
