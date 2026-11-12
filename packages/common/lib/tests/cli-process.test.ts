import { fork, spawnSync } from 'node:child_process';
import EventEmitter from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
	CLI_ACCEPTS_STOP_REQUESTS,
	CLI_STOP_REQUEST,
	createCliRunner,
	killChild,
	runCliCommand,
} from '@studio/common/lib/cli-process';
import type { ExecuteCliCommand } from '@studio/common/lib/cli-process';
import type { ChildProcess } from 'node:child_process';

vi.mock( 'node:child_process', () => ( { fork: vi.fn(), spawnSync: vi.fn() } ) );

// `killChild` branches on the platform: signals on POSIX, `taskkill /F /T` on Windows.
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
		connected: true,
		signals,
		send: vi.fn( ( _message: unknown, callback?: () => void ) => callback?.() ),
		kill: ( signal?: string ) => {
			signals.push( signal ?? 'SIGTERM' );
			return true;
		},
	} );
	return child as ChildProcess & { signals: string[] };
}

// A sync command, which announces that it decides for itself whether to stop.
function runSync() {
	const child = createStubbornChild();
	vi.mocked( fork ).mockReturnValue( child );
	const runner = createCliRunner( { cliBinary: 'main.mjs' } );
	runner.executeCliCommand( [ 'pull' ] );
	child.emit( 'message', CLI_ACCEPTS_STOP_REQUESTS );
	return { runner, child };
}

const taskkill = [ 'taskkill', [ '/F', '/T', '/PID', '1234' ], expect.anything() ];

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

	it( 'lets a stopped child outlive the host on POSIX', async () => {
		const { runner, child } = runSync();

		await runner.killAll( { force: false } );

		expect( child.signals ).toEqual( [ 'SIGTERM' ] );
		expect( child.send ).not.toHaveBeenCalled();
	} );
} );

describe( 'killChild on Windows', () => {
	beforeEach( () => {
		vi.mocked( spawnSync ).mockClear();
		setPlatform( 'win32' );
	} );

	afterEach( () => setPlatform( originalPlatform ) );

	// Windows ends a host's children with it, so a sync that has to finish needs the host to wait.
	it( 'asks a sync to stop over IPC, and waits for it on quit', async () => {
		const { runner, child } = runSync();
		let stopped = false;

		const stopping = runner.killAll( { force: false } ).then( () => ( stopped = true ) );
		await Promise.resolve();

		expect( child.send ).toHaveBeenCalledWith( CLI_STOP_REQUEST, expect.any( Function ) );
		expect( spawnSync ).not.toHaveBeenCalled();
		expect( stopped ).toBe( false );

		child.emit( 'close', 0, null );
		await stopping;
		expect( stopped ).toBe( true );
	} );

	it( 'ends the process tree of a command that takes no requests, or when forced', () => {
		const other = createStubbornChild();
		killChild( other, { force: false } );
		killChild( runSync().child );

		expect( spawnSync ).toHaveBeenCalledTimes( 2 );
		expect( spawnSync ).toHaveBeenCalledWith( ...taskkill );
		expect( other.signals ).toEqual( [] );
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
