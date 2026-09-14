import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn();

vi.mock( 'node:child_process', () => {
	const mockedModule = { spawn: spawnMock, spawnSync: vi.fn() };
	return { ...mockedModule, default: mockedModule };
} );

vi.mock( 'cli/lib/dependency-management/paths', () => ( {
	getPhpBinaryPath: () => '/fake/php',
} ) );

type FakeChild = EventEmitter & { stdout: PassThrough; stderr: PassThrough };

function createFakeChild(): FakeChild {
	const child = new EventEmitter() as FakeChild;
	child.stdout = new PassThrough();
	child.stderr = new PassThrough();
	return child;
}

/**
 * Drives a fake PHP child: emits the given output, then closes with `code`.
 * Deferred so the caller can await `runPhpCommand`'s promise while this runs.
 */
function respondWith( {
	stdout = '',
	stderr = '',
	code = 0,
}: {
	stdout?: string;
	stderr?: string;
	code?: number;
} ) {
	const child = createFakeChild();
	spawnMock.mockReturnValue( child );
	queueMicrotask( () => {
		if ( stdout ) {
			child.stdout.write( stdout );
		}
		if ( stderr ) {
			child.stderr.write( stderr );
		}
		queueMicrotask( () => child.emit( 'close', code ) );
	} );
	return child;
}

describe( 'runPhpCommand', () => {
	beforeEach( () => {
		vi.resetModules();
		spawnMock.mockReset();
	} );

	it( 'rejects with a PhpCommandError carrying the failed process output', async () => {
		const { runPhpCommand, PhpCommandError } = await import( 'cli/lib/native-php/php-process' );
		respondWith( {
			stdout: '{"type":"error","message":"Invalid Blueprint v1 provided."}\n',
			stderr: 'PHP Fatal error: boom\n',
			code: 1,
		} );

		const error = await runPhpCommand( [ 'script.php' ], { phpVersion: '8.4' } ).catch(
			( caught ) => caught
		);

		expect( error ).toBeInstanceOf( PhpCommandError );
		expect( error.exitCode ).toBe( 1 );
		expect( error.stdout ).toContain( 'Invalid Blueprint v1 provided.' );
		expect( error.stderr ).toContain( 'PHP Fatal error: boom' );
	} );

	// The Blueprint runner streams through `pipe`, so diagnostics must survive outside `capture`.
	it( 'captures failure output in pipe mode', async () => {
		const { runPhpCommand } = await import( 'cli/lib/native-php/php-process' );
		respondWith( { stderr: 'Could not open input file\n', code: 1 } );

		const error = await runPhpCommand( [ 'missing.php' ], {
			phpVersion: '8.4',
			mode: 'pipe',
		} ).catch( ( caught ) => caught );

		expect( error.stderr ).toContain( 'Could not open input file' );
	} );

	it( 'keeps the tail when a failing process writes more than the capture limit', async () => {
		const { runPhpCommand, MAX_CAPTURED_OUTPUT_CHARS } = await import(
			'cli/lib/native-php/php-process'
		);
		const noise = 'x'.repeat( MAX_CAPTURED_OUTPUT_CHARS );
		respondWith( { stdout: `${ noise }THE-REAL-ERROR`, code: 1 } );

		const error = await runPhpCommand( [ 'chatty.php' ], { phpVersion: '8.4' } ).catch(
			( caught ) => caught
		);

		expect( error.stdout ).toContain( 'THE-REAL-ERROR' );
		expect( error.stdout.length ).toBeLessThanOrEqual( MAX_CAPTURED_OUTPUT_CHARS );
	} );

	it( 'still resolves capture mode with the full stdout', async () => {
		const { runPhpCommand } = await import( 'cli/lib/native-php/php-process' );
		respondWith( { stdout: 'wordpress installed', code: 0 } );

		const result = await runPhpCommand( [ '-r', 'echo 1;' ], {
			phpVersion: '8.4',
			mode: 'capture',
		} );

		expect( result.stdout ).toBe( 'wordpress installed' );
	} );
} );
