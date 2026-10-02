import EventEmitter from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { killChild, runCliCommand } from '@studio/common/lib/cli-process';
import type { ExecuteCliCommand } from '@studio/common/lib/cli-process';
import type { ChildProcess } from 'node:child_process';

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

	it( 'leaves a child that exits on SIGTERM alone', () => {
		const child = createStubbornChild();

		killChild( child );
		Object.assign( child, { exitCode: 0 } );
		child.emit( 'exit', 0, null );
		vi.advanceTimersByTime( 5000 );

		expect( child.signals ).toEqual( [ 'SIGTERM' ] );
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
