import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Writable } from 'stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DaemonNotRunningError, runAttach } from 'cli/remote-session/attach';

class StringSink extends Writable {
	chunks: string[] = [];
	_write(
		chunk: Buffer | string,
		_encoding: BufferEncoding,
		callback: ( error?: Error | null ) => void
	) {
		this.chunks.push( typeof chunk === 'string' ? chunk : chunk.toString( 'utf8' ) );
		callback();
	}
	get text(): string {
		return this.chunks.join( '' );
	}
}

function jsonLine( msg: string, meta?: Record< string, unknown > ): string {
	const entry: Record< string, unknown > = {
		t: '2026-05-05T12:34:56.000Z',
		level: 'info',
		msg,
	};
	if ( meta ) {
		entry.meta = meta;
	}
	return JSON.stringify( entry ) + '\n';
}

describe( 'remote-session attach', () => {
	let tmpDir: string;
	let pidFile: string;
	let logFile: string;

	beforeEach( () => {
		tmpDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-remote-attach-' ) );
		pidFile = path.join( tmpDir, 'remote-session.pid' );
		logFile = path.join( tmpDir, 'remote-session.log' );
	} );

	afterEach( () => {
		fs.rmSync( tmpDir, { recursive: true, force: true } );
	} );

	async function reapedPid(): Promise< number > {
		const child = spawn( process.execPath, [ '-e', 'process.exit(0)' ], { stdio: 'ignore' } );
		const pid = child.pid;
		if ( typeof pid !== 'number' ) {
			throw new Error( 'Could not allocate a PID for the dead-process fixture' );
		}
		await new Promise< void >( ( resolve ) => child.once( 'exit', () => resolve() ) );
		return pid;
	}

	it( 'throws DaemonNotRunningError when no PID file exists', async () => {
		await expect( runAttach( { pidFile, logFile, out: new StringSink() } ) ).rejects.toBeInstanceOf(
			DaemonNotRunningError
		);
	} );

	it( 'throws DaemonNotRunningError when the PID file points to a dead process', async () => {
		const dead = await reapedPid();
		fs.writeFileSync( pidFile, `${ dead }\n`, 'utf8' );
		await expect( runAttach( { pidFile, logFile, out: new StringSink() } ) ).rejects.toBeInstanceOf(
			DaemonNotRunningError
		);
	} );

	it( 'streams new log lines until the abort signal fires', async () => {
		fs.writeFileSync( pidFile, `${ process.pid }\n`, 'utf8' );
		fs.writeFileSync( logFile, '', 'utf8' );

		const out = new StringSink();
		const controller = new AbortController();
		const promise = runAttach( {
			pidFile,
			logFile,
			out,
			signal: controller.signal,
			pollIntervalMs: 20,
			livenessIntervalMs: 10_000,
			initialTailBytes: 0,
		} );

		// Append two log lines after the watcher is ticking.
		await new Promise( ( resolve ) => setTimeout( resolve, 50 ) );
		fs.appendFileSync( logFile, jsonLine( 'first line' ), 'utf8' );
		await new Promise( ( resolve ) => setTimeout( resolve, 80 ) );
		fs.appendFileSync( logFile, jsonLine( 'second line', { foo: 'bar' } ), 'utf8' );
		await new Promise( ( resolve ) => setTimeout( resolve, 80 ) );

		controller.abort();
		await promise;

		expect( out.text ).toContain( 'first line' );
		expect( out.text ).toContain( 'second line' );
		expect( out.text ).toContain( '"foo":"bar"' );
		expect( out.text ).toContain( `Attached to remote-session daemon (PID ${ process.pid })` );
	} );

	it( 'replays the tail of an existing log on attach', async () => {
		fs.writeFileSync( pidFile, `${ process.pid }\n`, 'utf8' );
		fs.writeFileSync( logFile, jsonLine( 'historical entry' ), 'utf8' );

		const out = new StringSink();
		const controller = new AbortController();
		const promise = runAttach( {
			pidFile,
			logFile,
			out,
			signal: controller.signal,
			pollIntervalMs: 20,
			livenessIntervalMs: 10_000,
		} );
		await new Promise( ( resolve ) => setTimeout( resolve, 60 ) );
		controller.abort();
		await promise;

		expect( out.text ).toContain( 'historical entry' );
	} );

	it( 'reports daemon exit when the daemon process dies', async () => {
		// Spawn a real long-running child so we can kill it mid-attach.
		const itPosix = process.platform === 'win32';
		if ( itPosix ) {
			return;
		}
		const child = spawn( process.execPath, [ '-e', 'setInterval(() => {}, 60000);' ], {
			detached: true,
			stdio: 'ignore',
		} );
		child.unref();
		const childPid = child.pid;
		if ( typeof childPid !== 'number' ) {
			throw new Error( 'Could not spawn long-runner' );
		}
		fs.writeFileSync( pidFile, `${ childPid }\n`, 'utf8' );
		fs.writeFileSync( logFile, '', 'utf8' );

		const out = new StringSink();
		const promise = runAttach( {
			pidFile,
			logFile,
			out,
			pollIntervalMs: 20,
			livenessIntervalMs: 30,
			initialTailBytes: 0,
		} );

		// Let attach establish, then kill the child and wait for the loop to notice.
		await new Promise( ( resolve ) => setTimeout( resolve, 60 ) );
		try {
			process.kill( childPid, 'SIGKILL' );
		} catch {
			// already dead
		}
		await promise;

		expect( out.text ).toContain( `Remote-session daemon (PID ${ childPid }) exited` );
	}, 5000 );

	it( 'recovers from log rotation (size shrinks)', async () => {
		fs.writeFileSync( pidFile, `${ process.pid }\n`, 'utf8' );
		// Pre-fill with several long entries so the file is larger than the
		// post-rotation file we'll write later.
		const preLines = Array.from( { length: 20 }, ( _, i ) =>
			jsonLine( `pre-rotation-${ i }`, { padding: 'x'.repeat( 200 ) } )
		).join( '' );
		fs.writeFileSync( logFile, preLines, 'utf8' );

		const out = new StringSink();
		const controller = new AbortController();
		const promise = runAttach( {
			pidFile,
			logFile,
			out,
			signal: controller.signal,
			pollIntervalMs: 20,
			livenessIntervalMs: 10_000,
			initialTailBytes: 0,
		} );

		await new Promise( ( resolve ) => setTimeout( resolve, 60 ) );
		// Simulate rotation: truncate and write fresh, much shorter content so
		// size drops below the watcher's offset.
		fs.writeFileSync( logFile, jsonLine( 'post-rotation' ), 'utf8' );
		await new Promise( ( resolve ) => setTimeout( resolve, 80 ) );
		controller.abort();
		await promise;

		expect( out.text ).toContain( 'post-rotation' );
	} );
} );
