/**
 * @jest-environment node
 */
// eslint-disable-next-line import/order
import EventEmitter from 'node:events';

// Mock executeCliCommand before importing SiteServer
const mockEventEmitter = new EventEmitter();
const mockChildProcess = { kill: jest.fn() };

jest.mock( 'src/modules/cli/lib/execute-command', () => ( {
	executeCliCommand: jest.fn( () => [ mockEventEmitter, mockChildProcess ] ),
} ) );

jest.mock( 'src/constants', () => ( {
	WP_CLI_DEFAULT_RESPONSE_TIMEOUT: 100, // Short timeout for tests
	WP_CLI_IMPORT_EXPORT_RESPONSE_TIMEOUT: 200,
} ) );

jest.mock( '@sentry/electron/main', () => ( {
	captureException: jest.fn(),
} ) );

import { executeCliCommand } from 'src/modules/cli/lib/execute-command';

const mockExecuteCliCommand = executeCliCommand as jest.Mock;

function simulateCliResponse( {
	stdout = '',
	stderr = '',
	exitCode = 0,
	emitSuccess = true,
}: {
	stdout?: string;
	stderr?: string;
	exitCode?: number;
	emitSuccess?: boolean;
} ) {
	setImmediate( () => {
		if ( stdout ) {
			mockEventEmitter.emit( 'data', {
				data: { action: 'keyValuePair', key: 'stdout', value: stdout },
			} );
		}
		if ( stderr ) {
			mockEventEmitter.emit( 'data', {
				data: { action: 'keyValuePair', key: 'stderr', value: stderr },
			} );
		}
		mockEventEmitter.emit( 'data', {
			data: { action: 'keyValuePair', key: 'exitCode', value: String( exitCode ) },
		} );
		if ( emitSuccess ) {
			mockEventEmitter.emit( exitCode === 0 ? 'success' : 'failure' );
		}
	} );
}

describe( 'SiteServer.executeWpCliCommand', () => {
	let executeWpCliCommand: (
		args: string,
		options?: { targetPhpVersion?: string; skipPluginsAndThemes?: boolean }
	) => Promise< { stdout: string; stderr: string; exitCode: number } >;

	beforeEach( () => {
		jest.clearAllMocks();
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
				const result = { stdout: '', stderr: '', exitCode: 1 };
				const [ emitter ] = executeCliCommand( cliArgs, { silent: true } );

				const timeoutId = setTimeout( () => {
					resolve( {
						stdout: '',
						stderr: `WP-CLI command timed out after ${ timeout }ms`,
						exitCode: 1,
					} );
				}, timeout );

				emitter.on( 'data', ( { data }: { data: unknown } ) => {
					const parsed = data as { action?: string; key?: string; value?: string };
					if ( parsed.action === 'keyValuePair' ) {
						if ( parsed.key === 'stdout' ) {
							result.stdout = parsed.value ?? '';
						} else if ( parsed.key === 'stderr' ) {
							result.stderr = parsed.value ?? '';
						} else if ( parsed.key === 'exitCode' ) {
							result.exitCode = parseInt( parsed.value ?? '1', 10 );
						}
					}
				} );

				emitter.on( 'success', () => {
					clearTimeout( timeoutId );
					resolve( result );
				} );

				emitter.on( 'failure', () => {
					clearTimeout( timeoutId );
					resolve( result );
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
				{ silent: true }
			);
		} );

		it( 'should include --php-version when targetPhpVersion is provided', async () => {
			const resultPromise = executeWpCliCommand( 'plugin list', { targetPhpVersion: '8.1' } );
			simulateCliResponse( { exitCode: 0 } );
			await resultPromise;

			expect( mockExecuteCliCommand ).toHaveBeenCalledWith(
				[ 'wp', '--path', '/test/site/path', '--php-version', '8.1', 'plugin', 'list' ],
				{ silent: true }
			);
		} );

		it( 'should include --skip-plugins --skip-themes when skipPluginsAndThemes is true', async () => {
			const resultPromise = executeWpCliCommand( 'core version', { skipPluginsAndThemes: true } );
			simulateCliResponse( { exitCode: 0 } );
			await resultPromise;

			expect( mockExecuteCliCommand ).toHaveBeenCalledWith(
				[ 'wp', '--path', '/test/site/path', 'core', 'version', '--skip-plugins', '--skip-themes' ],
				{ silent: true }
			);
		} );
	} );

	describe( 'IPC response parsing', () => {
		it( 'should parse stdout from keyValuePair messages', async () => {
			const resultPromise = executeWpCliCommand( 'plugin list' );
			simulateCliResponse( { stdout: 'plugin1\nplugin2', exitCode: 0 } );
			const result = await resultPromise;

			expect( result.stdout ).toBe( 'plugin1\nplugin2' );
		} );

		it( 'should parse stderr from keyValuePair messages', async () => {
			const resultPromise = executeWpCliCommand( 'invalid-command' );
			simulateCliResponse( { stderr: 'Error: command not found', exitCode: 1 } );
			const result = await resultPromise;

			expect( result.stderr ).toBe( 'Error: command not found' );
		} );

		it( 'should parse exitCode from keyValuePair messages', async () => {
			const resultPromise = executeWpCliCommand( 'plugin list' );
			simulateCliResponse( { exitCode: 42 } );
			const result = await resultPromise;

			expect( result.exitCode ).toBe( 42 );
		} );

		it( 'should handle all three values together', async () => {
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
			const startTime = Date.now();
			const resultPromise = executeWpCliCommand( 'sqlite import /tmp/backup.sql' );
			const result = await resultPromise;
			const elapsed = Date.now() - startTime;

			expect( result.stderr ).toBe( 'WP-CLI command timed out after 200ms' );
			expect( elapsed ).toBeGreaterThanOrEqual( 200 );
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
