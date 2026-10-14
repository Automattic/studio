import { ChildProcess } from 'node:child_process';
import EventEmitter from 'node:events';
import { vi } from 'vitest';
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
import { executeWpCliCommand } from 'src/lib/sites';
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

describe( 'executeWpCliCommand', () => {
	const site = { id: 'site-id', path: '/test/site/path' };
	const run = ( args: string[], options?: { skipPluginsAndThemes?: boolean } ) =>
		executeWpCliCommand( site, args, options );
	const captureOptions = expect.objectContaining( { output: 'capture', logPrefix: 'site-id' } );

	beforeEach( () => {
		vi.clearAllMocks();
		mockEventEmitter.removeAllListeners();
		mockExecuteCliCommand.mockReturnValue( [ mockEventEmitter, mockChildProcess ] );
	} );

	describe( 'CLI spawning', () => {
		it( 'should spawn CLI with correct arguments', async () => {
			const resultPromise = run( [ 'plugin', 'list' ] );
			simulateCliResponse( { stdout: 'plugin output', exitCode: 0 } );
			await resultPromise;

			expect( mockExecuteCliCommand ).toHaveBeenCalledWith(
				[ 'wp', '--path', '/test/site/path', 'plugin', 'list' ],
				captureOptions
			);
		} );

		it( 'should include --skip-plugins --skip-themes when skipPluginsAndThemes is true', async () => {
			const resultPromise = run( [ 'core', 'version' ], { skipPluginsAndThemes: true } );
			simulateCliResponse( { exitCode: 0 } );
			await resultPromise;

			expect( mockExecuteCliCommand ).toHaveBeenCalledWith(
				[ 'wp', '--path', '/test/site/path', 'core', 'version', '--skip-plugins', '--skip-themes' ],
				captureOptions
			);
		} );
	} );

	describe( 'captured output parsing', () => {
		it( 'should capture stdout from CLI process', async () => {
			const resultPromise = run( [ 'plugin', 'list' ] );
			simulateCliResponse( { stdout: 'plugin1\nplugin2', exitCode: 0 } );
			const result = await resultPromise;

			expect( result.stdout ).toBe( 'plugin1\nplugin2' );
		} );

		it( 'should capture stderr from CLI process', async () => {
			const resultPromise = run( [ 'invalid-command' ] );
			simulateCliResponse( { stderr: 'Error: command not found', exitCode: 1 } );
			const result = await resultPromise;

			expect( result.stderr ).toBe( 'Error: command not found' );
		} );

		it( 'should capture all output values together', async () => {
			const resultPromise = run( [ 'plugin', 'list' ] );
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
		it( 'should handle child process errors', async () => {
			const resultPromise = run( [ 'plugin', 'list' ] );
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
			const resultPromise = run( [ 'plugin', 'list' ] );
			const result = await resultPromise;

			expect( result.stderr ).toBe( 'WP-CLI command timed out after 100ms' );
			expect( result.exitCode ).toBe( 1 );
		} );

		it( 'should use longer timeout for sqlite import/export commands', async () => {
			vi.useFakeTimers();
			try {
				const resultPromise = run( [ 'sqlite', 'import', '/tmp/backup.sql' ] );
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
			const resultPromise = run( [ 'plugin', 'list' ] );
			simulateCliResponse( { stdout: 'quick response', exitCode: 0 } );
			const result = await resultPromise;

			expect( result.stdout ).toBe( 'quick response' );
			expect( result.stderr ).not.toContain( 'timed out' );
		} );
	} );
} );
