import { fork } from 'node:child_process';
import EventEmitter from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
	createCliRunner,
	killChild,
	runCliCommand,
	type CliCommandError,
	ExecuteCliCommand,
} from '@studio/common/lib/cli-process';
import { dropExpectedErrors } from '@studio/common/lib/error-reporting';
import type { ChildProcess } from 'node:child_process';

vi.mock( 'node:child_process', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('node:child_process') >() ),
	fork: vi.fn(),
} ) );

// `killChild` branches on the platform: signals on POSIX, `taskkill /F /T` on
// Windows. Pin it to POSIX so these run the same everywhere — on a Windows host
// they would otherwise fire a real `taskkill` at whatever holds this pid.
const originalPlatform = process.platform;
function setPlatform( platform: NodeJS.Platform ) {
	Object.defineProperty( process, 'platform', { value: platform, configurable: true } );
}

// A child that is still running: `kill()` records the signal but, like the real
// CLI (which registers a SIGTERM handler that never exits), it does not die.
function createStubbornChild() {
	const child = new EventEmitter() as unknown as ChildProcess & { signals: string[] };
	const signals: string[] = [];
	Object.assign( child, {
		pid: 1234,
		exitCode: null,
		signalCode: null,
		signals,
		kill: ( signal?: string ) => {
			signals.push( signal ?? 'SIGTERM' );
			return true;
		},
	} );
	return child as ChildProcess & { signals: string[] };
}

describe( 'killChild', () => {
	beforeEach( () => {
		vi.useFakeTimers();
		setPlatform( 'darwin' );
	} );

	afterEach( () => {
		vi.useRealTimers();
		setPlatform( originalPlatform );
	} );

	it( 'escalates to SIGKILL when the child ignores SIGTERM', () => {
		const child = createStubbornChild();

		killChild( child );
		expect( child.signals ).toEqual( [ 'SIGTERM' ] );

		vi.advanceTimersByTime( 5000 );

		// Without this a cancelled sync reports "stopped" while the CLI keeps
		// importing into the site.
		expect( child.signals ).toEqual( [ 'SIGTERM', 'SIGKILL' ] );
	} );

	it( 'only asks when not forced, so a sync that must finish can', () => {
		const child = createStubbornChild();

		killChild( child, { force: false } );
		vi.advanceTimersByTime( 5000 );

		expect( child.signals ).toEqual( [ 'SIGTERM' ] );
	} );

	it( 'leaves a child that exits on SIGTERM alone', () => {
		const child = createStubbornChild();

		killChild( child );
		Object.assign( child, { exitCode: 0 } );
		child.emit( 'exit', 0, null );
		vi.advanceTimersByTime( 5000 );

		expect( child.signals ).toEqual( [ 'SIGTERM' ] );
	} );
} );

describe( 'createCliRunner', () => {
	afterEach( () => setPlatform( originalPlatform ) );

	it( 'tells a command its host stopped apart from one that failed', async () => {
		setPlatform( 'darwin' );
		const [ stopped, failed ] = [ createStubbornChild(), createStubbornChild() ];
		vi.mocked( fork ).mockReturnValueOnce( stopped ).mockReturnValueOnce( failed );
		const runner = createCliRunner( { cliBinary: 'main.mjs' } );
		const [ stoppedError, failedError ] = [ stopped, failed ].map( () => {
			const [ emitter ] = runner.executeCliCommand( [ 'site', 'create' ] );
			return new Promise< CliCommandError >( ( resolve ) =>
				emitter.on( 'failure', ( { error } ) => resolve( error ) )
			);
		} );

		killChild( stopped, { force: false } );
		// `taskkill /F` ends a Windows process with exit code 1, the same as a failure.
		stopped.emit( 'close', 1, null );
		failed.emit( 'close', 1, null );

		const event = { message: 'event' };
		expect( ( await stoppedError ).message ).toContain( '[Stopped by Studio]' );
		expect( dropExpectedErrors( event, { originalException: await stoppedError } ) ).toBeNull();
		expect( ( await failedError ).message ).toContain( '[Exit code] 1' );
		expect( dropExpectedErrors( event, { originalException: await failedError } ) ).toBe( event );
	} );
} );

describe( 'runCliCommand', () => {
	const schema = z.object( { url: z.string() } );

	function fakeCli( ...messages: unknown[] ) {
		const emitter = new EventEmitter();
		const execute = vi.fn( () => {
			queueMicrotask( () => {
				for ( const data of messages ) {
					emitter.emit( 'data', { data } );
				}
				emitter.emit( 'success' );
			} );
			return [ emitter, {} ];
		} ) as unknown as ExecuteCliCommand;
		return execute;
	}

	it( 'resolves with the reported result and forwards progress', async () => {
		const onProgress = vi.fn();
		const execute = fakeCli(
			{ action: 'upload', status: 'inprogress', message: 'Uploading…' },
			{ action: 'result', value: { url: 'https://a.example' } }
		);

		await expect(
			runCliCommand( execute, [ 'preview', 'create' ], schema, { onProgress } )
		).resolves.toEqual( { url: 'https://a.example' } );
		expect( onProgress ).toHaveBeenCalledWith( 'Uploading…' );
	} );

	it.each( [
		[ 'reports no result', fakeCli(), /reported no result/ ],
		[ 'reports a malformed result', fakeCli( { action: 'result', value: { url: 1 } } ), /url/ ],
	] )( 'rejects when the command %s', async ( _case, execute, error ) => {
		await expect( runCliCommand( execute, [ 'preview', 'create' ], schema ) ).rejects.toThrow(
			error
		);
	} );

	it( 'resolves once the command says it finished, while its process is still running', async () => {
		const emitter = new EventEmitter();
		const execute = vi.fn( () => {
			queueMicrotask( () => {
				emitter.emit( 'data', { data: { action: 'result', value: { url: 'https://a.example' } } } );
				emitter.emit( 'data', { data: { action: 'done' } } );
			} );
			return [ emitter, {} ];
		} ) as unknown as ExecuteCliCommand;

		await expect( runCliCommand( execute, [ 'site', 'create' ], schema ) ).resolves.toEqual( {
			url: 'https://a.example',
		} );
	} );

	it( 'rejects with the command error when it fails', async () => {
		const emitter = new EventEmitter();
		const execute = vi.fn( () => {
			queueMicrotask( () => emitter.emit( 'failure', { error: new Error( 'Upload failed' ) } ) );
			return [ emitter, {} ];
		} ) as unknown as ExecuteCliCommand;

		await expect( runCliCommand( execute, [ 'preview', 'create' ], schema ) ).rejects.toThrow(
			'Upload failed'
		);
	} );
} );
