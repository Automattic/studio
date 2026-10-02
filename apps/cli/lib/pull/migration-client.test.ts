import { ChildProcess, fork } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { spawnPhpProcess } from 'cli/lib/native-php/php-process';
import { runReprintCommandUntilComplete, type ReprintProcessResult } from './migration-client';

vi.mock( 'node:child_process', () => {
	const mocked = { fork: vi.fn() };
	return { ...mocked, default: mocked };
} );
vi.mock( 'node:fs', () => ( {
	default: { existsSync: vi.fn( () => true ), mkdirSync: vi.fn() },
} ) );
vi.mock( 'cli/lib/dependency-management/paths', () => ( {
	getReprintPharPath: () => '/bundle/reprint.phar',
} ) );
vi.mock( 'cli/lib/dependency-management/php-binary', () => ( {
	ensurePhpBinaryAvailable: vi.fn(),
} ) );
vi.mock( 'cli/lib/native-php/php-process', () => ( {
	spawnPhpProcess: vi.fn(),
	reapPhpTreeOnInterrupt: vi.fn( () => vi.fn() ),
} ) );

for ( const runtime of [ 'native-php', 'playground' ] as const ) {
	describe( `Reprint retries (${ runtime })`, () => {
		let results: ReprintProcessResult[];
		let children: ChildProcess[];
		const args = [ 'pull-db', 'https://example.com', '--state-dir=/state', '--fs-root=/files' ];

		beforeEach( () => {
			vi.useFakeTimers();
			results = [];
			children = [];
			vi.mocked( spawnPhpProcess ).mockImplementation( () => createChild( false ) );
			vi.mocked( fork ).mockImplementation( () => createChild( true ) );
		} );

		afterEach( () => {
			vi.clearAllTimers();
			vi.useRealTimers();
		} );

		it( 'keeps immediate exit-2 resumes for older Reprint versions without new JSON fields', async () => {
			results.push( result( 2 ), result( 2 ), result( 0 ) );
			const progress = vi.fn();
			const completion = run( progress );
			await vi.advanceTimersByTimeAsync( 0 );
			expect( ( await completion ).exitCode ).toBe( 0 );
			expect( children ).toHaveLength( 3 );
			expect( progress ).not.toHaveBeenCalledWith( expect.stringContaining( 'Retrying' ) );
			expect( vi.getTimerCount() ).toBe( 0 );
		} );

		it( 'waits 15 seconds then 45 seconds and resumes the same command and paths', async () => {
			results.push( result( 3 ), result( 3 ), result( 0 ) );
			const progress = vi.fn();
			const completion = run( progress );
			await vi.advanceTimersByTimeAsync( 0 );
			expect( children ).toHaveLength( 1 );
			expect( progress ).toHaveBeenLastCalledWith( expect.stringContaining( '15 seconds' ) );
			await vi.advanceTimersByTimeAsync( 14_999 );
			expect( children ).toHaveLength( 1 );
			expect( progress ).toHaveBeenLastCalledWith( expect.stringContaining( '15 seconds' ) );
			await vi.advanceTimersByTimeAsync( 1 );
			expect( children ).toHaveLength( 2 );
			expect( progress ).toHaveBeenLastCalledWith( expect.stringContaining( '45 seconds' ) );
			await vi.advanceTimersByTimeAsync( 44_999 );
			expect( children ).toHaveLength( 2 );
			await vi.advanceTimersByTimeAsync( 1 );
			expect( ( await completion ).exitCode ).toBe( 0 );
			expect( children ).toHaveLength( 3 );
			if ( runtime === 'native-php' ) {
				for ( const [ command ] of vi.mocked( spawnPhpProcess ).mock.calls ) {
					expect( command ).toEqual( [ '/bundle/reprint.phar', ...args ] );
				}
			} else {
				for ( const child of children ) {
					expect( child.send ).toHaveBeenCalledWith(
						expect.objectContaining( {
							args,
							stateDir: '/state',
							fsRoot: '/files',
						} )
					);
				}
			}
			expect( vi.getTimerCount() ).toBe( 0 );
		} );

		it( 'stops after two delayed retries and preserves the final error details', async () => {
			const error = JSON.stringify( {
				status: 'error',
				error: 'Upstream unavailable',
				http_code: 520,
				error_code: 'SERVER_ERROR',
				exception: 'Reprint\\Importer\\TransientInterruptionException',
				consecutive_failures_without_progress: 3,
			} );
			results.push( result( 3 ), result( 3 ), {
				exitCode: 3,
				stdout: error,
				stderr: 'Final diagnostics',
			} );
			const failure = run().catch( ( caught: unknown ) => caught );
			await vi.advanceTimersByTimeAsync( 60_000 );
			expect( await failure ).toBeInstanceOf( Error );
			expect( ( ( await failure ) as Error ).message ).toContain( error );
			expect( ( ( await failure ) as Error ).message ).toContain( 'Final diagnostics' );
			expect( children ).toHaveLength( 3 );
			expect( vi.getTimerCount() ).toBe( 0 );
		} );

		it( 'does not reset the delayed retry limit after an exit-2 resume', async () => {
			results.push( result( 3 ), result( 2 ), result( 3 ), result( 2 ), result( 3 ) );
			const failure = run().catch( ( caught: unknown ) => caught );
			await vi.advanceTimersByTimeAsync( 60_000 );
			expect( await failure ).toBeInstanceOf( Error );
			expect( children ).toHaveLength( 5 );
			expect( vi.getTimerCount() ).toBe( 0 );
		} );

		it.each( [ 1, 64 ] )(
			'stops on exit %i without retrying or reporting success',
			async ( exitCode ) => {
				results.push( { exitCode, stdout: '', stderr: '' } );
				await expect( run() ).rejects.toThrow( `exited with code ${ exitCode }` );
				expect( children ).toHaveLength( 1 );
				expect( vi.getTimerCount() ).toBe( 0 );
			}
		);

		it( 'stops immediately if a delayed retry returns a permanent error', async () => {
			results.push( result( 3 ), { exitCode: 1, stdout: '', stderr: 'Authentication failed' } );
			const failure = run().catch( ( caught: unknown ) => caught );
			await vi.advanceTimersByTimeAsync( 15_000 );
			expect( ( ( await failure ) as Error ).message ).toContain( 'Authentication failed' );
			expect( children ).toHaveLength( 2 );
			expect( vi.getTimerCount() ).toBe( 0 );
		} );

		function run( progress?: ( output: string ) => void ) {
			return runReprintCommandUntilComplete( '/state', '/files', args, progress, { runtime } );
		}

		function result( exitCode: number ): ReprintProcessResult {
			if ( exitCode === 3 ) {
				return {
					exitCode,
					stdout: JSON.stringify( { status: 'error', error: 'Temporary remote failure' } ),
					stderr: '',
				};
			}
			return {
				exitCode,
				stdout: JSON.stringify( { status: exitCode === 0 ? 'complete' : 'partial' } ),
				stderr: '',
			};
		}

		function createChild( wasm: boolean ): ChildProcess {
			const child = new EventEmitter() as ChildProcess;
			child.stdout = new PassThrough();
			child.stderr = new PassThrough();
			children.push( child );
			const respond = () =>
				queueMicrotask( () => {
					const next = results.shift();
					if ( ! next ) {
						throw new Error( 'Unexpected Reprint invocation' );
					}
					if ( wasm ) {
						child.emit( 'message', { type: 'stdout', chunk: next.stdout + '\n' } );
						child.emit( 'message', { type: 'result', ...next } );
					} else {
						( child.stdout as PassThrough ).write( next.stdout + '\n' );
						( child.stderr as PassThrough ).write( next.stderr );
						child.emit( 'close', next.exitCode );
					}
				} );
			if ( wasm ) {
				child.send = vi.fn().mockImplementation( respond );
			} else {
				respond();
			}
			return child;
		}
	} );
}
