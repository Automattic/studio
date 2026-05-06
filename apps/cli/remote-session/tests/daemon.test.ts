import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	DAEMON_CHILD_ENV_VAR,
	DaemonAlreadyRunningError,
	DaemonStartTimeoutError,
	getDaemonStatus,
	installDaemonChildHooks,
	isDaemonChild,
	startDaemon,
	stopDaemon,
} from 'cli/remote-session/daemon';

describe( 'remote-session daemon helpers', () => {
	let tmpDir: string;
	let pidFile: string;

	beforeEach( () => {
		tmpDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-remote-daemon-' ) );
		pidFile = path.join( tmpDir, 'remote-session.pid' );
	} );

	afterEach( () => {
		fs.rmSync( tmpDir, { recursive: true, force: true } );
	} );

	/**
	 * Spawn a transient Node child, await its exit, and return its PID. Linux
	 * with `pid_max=4194304` makes any hardcoded sentinel (e.g. 999999)
	 * potentially live; this guarantees the PID points at a process that has
	 * already terminated.
	 */
	async function reapedPid(): Promise< number > {
		const child = spawn( process.execPath, [ '-e', 'process.exit(0)' ], { stdio: 'ignore' } );
		const pid = child.pid;
		if ( typeof pid !== 'number' ) {
			throw new Error( 'Could not allocate a PID for the dead-process fixture' );
		}
		await new Promise< void >( ( resolve ) => child.once( 'exit', () => resolve() ) );
		return pid;
	}

	describe( 'isDaemonChild', () => {
		it( 'returns true when the env var is set to "1"', () => {
			expect( isDaemonChild( { [ DAEMON_CHILD_ENV_VAR ]: '1' } ) ).toBe( true );
		} );

		it( 'returns false when the env var is unset or any other value', () => {
			expect( isDaemonChild( {} ) ).toBe( false );
			expect( isDaemonChild( { [ DAEMON_CHILD_ENV_VAR ]: '' } ) ).toBe( false );
			expect( isDaemonChild( { [ DAEMON_CHILD_ENV_VAR ]: 'true' } ) ).toBe( false );
		} );
	} );

	describe( 'getDaemonStatus', () => {
		it( 'reports not running when the PID file does not exist', () => {
			const status = getDaemonStatus( pidFile );
			expect( status.running ).toBe( false );
			expect( status.pid ).toBeUndefined();
			expect( status.staleFileRemoved ).toBeUndefined();
		} );

		it( 'reports running when the PID file points to a live process', () => {
			fs.writeFileSync( pidFile, `${ process.pid }\n`, 'utf8' );
			const status = getDaemonStatus( pidFile );
			expect( status.running ).toBe( true );
			expect( status.pid ).toBe( process.pid );
		} );

		it( 'cleans up stale PID files that point to dead processes', async () => {
			const dead = await reapedPid();
			fs.writeFileSync( pidFile, `${ dead }\n`, 'utf8' );
			const status = getDaemonStatus( pidFile );
			expect( status.running ).toBe( false );
			expect( status.pid ).toBe( dead );
			expect( status.staleFileRemoved ).toBe( true );
			expect( fs.existsSync( pidFile ) ).toBe( false );
		} );

		it( 'treats a malformed PID file as not running', () => {
			fs.writeFileSync( pidFile, 'not a number\n', 'utf8' );
			const status = getDaemonStatus( pidFile );
			expect( status.running ).toBe( false );
			expect( status.pid ).toBeUndefined();
		} );
	} );

	describe( 'installDaemonChildHooks', () => {
		it( 'writes the current PID and reports running, then `remove` clears it', () => {
			const handle = installDaemonChildHooks( pidFile );
			try {
				expect( fs.existsSync( pidFile ) ).toBe( true );
				const written = Number.parseInt( fs.readFileSync( pidFile, 'utf8' ).trim(), 10 );
				expect( written ).toBe( process.pid );
				const status = getDaemonStatus( pidFile );
				expect( status.running ).toBe( true );
				expect( status.pid ).toBe( process.pid );
			} finally {
				handle.remove();
			}
			expect( fs.existsSync( pidFile ) ).toBe( false );
		} );

		it( 'writes the PID file with mode 0600 on POSIX', () => {
			if ( process.platform === 'win32' ) {
				return;
			}
			const handle = installDaemonChildHooks( pidFile );
			try {
				const stat = fs.statSync( pidFile );
				expect( stat.mode & 0o777 ).toBe( 0o600 );
			} finally {
				handle.remove();
			}
		} );

		it( 'remove() is idempotent', () => {
			const handle = installDaemonChildHooks( pidFile );
			handle.remove();
			expect( () => handle.remove() ).not.toThrow();
		} );
	} );

	describe( 'startDaemon / stopDaemon', () => {
		// On Windows, signal-based termination behaves differently and the
		// integration becomes flaky. The unit-level coverage above plus
		// startDaemon's "already running" guard are sufficient there.
		const itPosix = process.platform === 'win32' ? it.skip : it;

		itPosix(
			'spawns a long-running child, getDaemonStatus reports it, and stopDaemon terminates it',
			async () => {
				const child = spawnLongRunner( pidFile );
				try {
					await waitForFile( pidFile, 5000 );
					const status = getDaemonStatus( pidFile );
					expect( status.running ).toBe( true );
					expect( status.pid ).toBe( child.pid );

					const result = await stopDaemon( { timeoutMs: 3000 }, pidFile );
					expect( result.stopped ).toBe( true );
					expect( result.alreadyStopped ).toBeFalsy();
					expect( fs.existsSync( pidFile ) ).toBe( false );
				} finally {
					if ( child.pid && isAlive( child.pid ) ) {
						try {
							process.kill( child.pid, 'SIGKILL' );
						} catch {
							// ignore
						}
					}
				}
			},
			15000
		);

		itPosix( 'startDaemon throws DaemonAlreadyRunningError when the PID file is live', async () => {
			fs.writeFileSync( pidFile, `${ process.pid }\n`, 'utf8' );
			await expect( startDaemon( {}, pidFile ) ).rejects.toBeInstanceOf(
				DaemonAlreadyRunningError
			);
		} );

		itPosix(
			'startDaemon spawns the child with --no-detach so it runs in foreground mode',
			async () => {
				// Write a fake CLI entry that records its argv, then writes the
				// PID file so startDaemon resolves cleanly.
				const argvFile = path.join( tmpDir, 'argv.json' );
				const fakeEntry = path.join( tmpDir, 'argv-recorder.cjs' );
				fs.writeFileSync(
					fakeEntry,
					`const fs = require('fs');
fs.writeFileSync(${ JSON.stringify( argvFile ) }, JSON.stringify(process.argv));
fs.writeFileSync(${ JSON.stringify( pidFile ) }, String(process.pid) + '\\n', { mode: 0o600 });
setInterval(() => {}, 60000);
`,
					'utf8'
				);
				try {
					const result = await startDaemon( { cliEntry: fakeEntry, pidFileWaitMs: 5000 }, pidFile );
					const argv = JSON.parse( fs.readFileSync( argvFile, 'utf8' ) ) as string[];
					expect( argv ).toContain( '--no-detach' );
					expect( argv ).toContain( 'remote-session' );
					expect( argv ).toContain( 'start' );
					// Cleanup the long-runner.
					try {
						process.kill( result.pid, 'SIGKILL' );
					} catch {
						// ignore
					}
				} finally {
					fs.rmSync( pidFile, { force: true } );
				}
			},
			15000
		);

		itPosix(
			'startDaemon raises DaemonStartTimeoutError when the child never writes the PID file',
			async () => {
				// Spawn a child that exits immediately — it never has a chance to write the PID file.
				const fakeBin = process.execPath;
				const fakeEntry = path.join( tmpDir, 'noop.cjs' );
				fs.writeFileSync( fakeEntry, 'process.exit(0);\n', 'utf8' );
				await expect(
					startDaemon(
						{
							execPath: fakeBin,
							cliEntry: fakeEntry,
							pidFileWaitMs: 500,
						},
						pidFile
					)
				).rejects.toBeInstanceOf( DaemonStartTimeoutError );
			},
			10000
		);

		it( 'stopDaemon returns alreadyStopped when no PID file exists', async () => {
			const result = await stopDaemon( {}, pidFile );
			expect( result.stopped ).toBe( true );
			expect( result.alreadyStopped ).toBe( true );
		} );

		it( 'stopDaemon cleans up a stale PID file pointing at a dead PID', async () => {
			const dead = await reapedPid();
			fs.writeFileSync( pidFile, `${ dead }\n`, 'utf8' );
			const result = await stopDaemon( {}, pidFile );
			expect( result.stopped ).toBe( true );
			expect( result.alreadyStopped ).toBe( true );
			expect( fs.existsSync( pidFile ) ).toBe( false );
		} );
	} );
} );

/**
 * Spawn a tiny detached Node child that writes the PID file and then sleeps,
 * so we can exercise the real startDaemon/stopDaemon flow without depending
 * on the full studio CLI bundle.
 */
function spawnLongRunner( pidFile: string ): {
	pid: number | undefined;
} {
	const script = `
		const fs = require('fs');
		fs.writeFileSync(${ JSON.stringify( pidFile ) }, String(process.pid) + '\\n', { mode: 0o600 });
		const cleanup = () => {
			try { fs.rmSync(${ JSON.stringify( pidFile ) }, { force: true }); } catch (_) {}
			process.exit(0);
		};
		process.on('SIGTERM', cleanup);
		process.on('SIGINT', cleanup);
		setInterval(() => {}, 60000);
	`;
	const child = spawn( process.execPath, [ '-e', script ], {
		detached: true,
		stdio: 'ignore',
	} );
	child.unref();
	return { pid: child.pid };
}

async function waitForFile( filePath: string, timeoutMs: number ): Promise< void > {
	const deadline = Date.now() + timeoutMs;
	while ( Date.now() < deadline ) {
		if ( fs.existsSync( filePath ) ) {
			return;
		}
		await new Promise( ( resolve ) => setTimeout( resolve, 25 ) );
	}
	throw new Error( `File ${ filePath } never appeared within ${ timeoutMs }ms` );
}

function isAlive( pid: number ): boolean {
	try {
		process.kill( pid, 0 );
		return true;
	} catch ( error ) {
		const code = ( error as NodeJS.ErrnoException ).code;
		return code === 'EPERM';
	}
}
