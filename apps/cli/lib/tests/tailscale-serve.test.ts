import { spawn, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
	SERVE_WATCHDOG,
	spawnServe,
	startTailscaleServe,
	waitForTailscaleHttps,
} from 'cli/lib/tailscale-serve';

function fakeChild() {
	const child = Object.assign( new EventEmitter(), {
		stderr: new EventEmitter(),
		exitCode: null as number | null,
		signalCode: null as NodeJS.Signals | null,
		kill: vi.fn( () => true ),
	} );
	return child;
}

describe( 'startTailscaleServe', () => {
	it( 'serves HTTPS on the port in the foreground, forwarding to loopback', () => {
		const child = fakeChild();
		const spawnFile = vi.fn( () => child );

		startTailscaleServe( '/usr/bin/tailscale', 8084, spawnFile );

		expect( spawnFile ).toHaveBeenCalledWith( '/usr/bin/tailscale', [
			'serve',
			'--https=8084',
			'http://127.0.0.1:8084',
		] );
	} );

	it( "ends with Tailscale's last error line", async () => {
		const child = fakeChild();
		const serve = startTailscaleServe( '/usr/bin/tailscale', 8084, () => child );

		child.stderr.emit( 'data', 'Serve started.\n' );
		child.stderr.emit( 'data', 'error enabling https feature: HTTPS is not enabled\n' );
		child.emit( 'exit', 1 );

		await expect( serve.ended ).resolves.toBe(
			'error enabling https feature: HTTPS is not enabled'
		);
	} );

	it( 'stops a running child, and leaves an ended one alone', () => {
		const child = fakeChild();
		const serve = startTailscaleServe( '/usr/bin/tailscale', 8084, () => child );

		serve.stop();
		expect( child.kill ).toHaveBeenCalledTimes( 1 );

		child.exitCode = 0;
		serve.stop();
		expect( child.kill ).toHaveBeenCalledTimes( 1 );
	} );

	// On Windows `kill` ends the watchdog at once, without its handlers, so the
	// stop goes through the IPC channel, which the watchdog answers on every system.
	it( 'stops the watchdog through its IPC channel when it has one', () => {
		const child = Object.assign( fakeChild(), { connected: true, disconnect: vi.fn() } );
		const serve = startTailscaleServe( '/usr/bin/tailscale', 8084, () => child );

		serve.stop();

		expect( child.disconnect ).toHaveBeenCalledTimes( 1 );
		expect( child.kill ).not.toHaveBeenCalled();
	} );

	// The shutdown and the exit hook both stop it; a second stop must not kill the
	// watchdog before its `disconnect` handler has ended `tailscale serve`.
	it( 'stops only once, even when asked again before the watchdog ends', () => {
		const child = Object.assign( fakeChild(), { connected: true, disconnect: vi.fn() } );
		child.disconnect.mockImplementation( () => {
			child.connected = false;
		} );
		const serve = startTailscaleServe( '/usr/bin/tailscale', 8084, () => child );

		serve.stop();
		serve.stop();

		expect( child.disconnect ).toHaveBeenCalledTimes( 1 );
		expect( child.kill ).not.toHaveBeenCalled();
	} );
} );

describe( 'waitForTailscaleHttps', () => {
	const URL = 'https://my-mac.tail1234.ts.net:8084';
	const answer = ( instanceId: string ) =>
		new Response( JSON.stringify( { instanceId } ), { status: 200 } );

	it( 'returns once its own HTTPS address answers with its instance id', async () => {
		const fetchFn = vi
			.fn()
			.mockRejectedValueOnce( new Error( 'certificate not ready' ) )
			.mockResolvedValueOnce( answer( 'instance-1' ) );
		const sleep = vi.fn().mockResolvedValue( undefined );

		await waitForTailscaleHttps( {
			url: URL,
			instanceId: 'instance-1',
			ended: new Promise( () => {} ),
			fetchFn,
			sleep,
		} );

		expect( fetchFn ).toHaveBeenLastCalledWith(
			`${ URL }/.well-known/studio/remote`,
			expect.anything()
		);
		expect( sleep ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'does not accept another computer answering at that address', async () => {
		let clock = 0;
		await expect(
			waitForTailscaleHttps( {
				url: URL,
				instanceId: 'instance-1',
				ended: new Promise( () => {} ),
				fetchFn: vi.fn().mockImplementation( async () => answer( 'someone-else' ) ),
				sleep: async () => {
					clock += 1000;
				},
				now: () => clock,
				limitMs: 3000,
			} )
		).rejects.toThrow( `No answer at ${ URL } within 60 seconds (another computer answered).` );
	} );

	it( 'says why the last try failed when the name or the certificate does not work', async () => {
		let clock = 0;
		const failure = Object.assign( new TypeError( 'fetch failed' ), {
			cause: new Error( 'getaddrinfo ENOTFOUND my-mac.tail1234.ts.net' ),
		} );
		await expect(
			waitForTailscaleHttps( {
				url: URL,
				instanceId: 'instance-1',
				ended: new Promise( () => {} ),
				fetchFn: vi.fn().mockRejectedValue( failure ),
				sleep: async () => {
					clock += 1000;
				},
				now: () => clock,
				limitMs: 2000,
			} )
		).rejects.toThrow(
			`No answer at ${ URL } within 60 seconds (getaddrinfo ENOTFOUND my-mac.tail1234.ts.net).`
		);
	} );

	it( "fails with Tailscale's reason when tailscale serve ends first", async () => {
		await expect(
			waitForTailscaleHttps( {
				url: URL,
				instanceId: 'instance-1',
				ended: Promise.resolve( 'error enabling https feature' ),
				fetchFn: vi.fn().mockRejectedValue( new Error( 'connection refused' ) ),
				sleep: async () => {},
			} )
		).rejects.toThrow( 'error enabling https feature' );
	} );
} );

describe( 'spawnServe', () => {
	it( 'runs tailscale serve under the watchdog, with an IPC channel back to this process', () => {
		const child = spawnServe( process.execPath, [
			'-e',
			'setTimeout( () => {}, 5000 )',
		] ) as unknown as {
			spawnargs: string[];
			connected: boolean;
			kill: () => boolean;
		};
		try {
			expect( child.spawnargs ).toEqual( [
				process.execPath,
				'-e',
				SERVE_WATCHDOG,
				process.execPath,
				'-e',
				'setTimeout( () => {}, 5000 )',
			] );
			expect( child.connected ).toBe( true );
		} finally {
			child.kill();
		}
	} );
} );

describe( 'SERVE_WATCHDOG', () => {
	// The property remote mode relies on: `tailscale serve` (here a Node process
	// that only waits) ends when the process that started it is killed outright.
	it.skipIf( process.platform === 'win32' )(
		'ends tailscale serve when the process that started it is killed with SIGKILL',
		async () => {
			const marker = `studio-serve-watchdog-${ process.pid }-${ Date.now() }`;
			const fakeServe = [ '-e', `setInterval( () => {}, 1000 ); // ${ marker }` ];
			const watchdogArgs = [ '-e', SERVE_WATCHDOG, process.execPath, ...fakeServe ];
			// Starts the watchdog the way `studio remote` does, with an IPC channel.
			const parent = spawn(
				process.execPath,
				[
					'-e',
					`require( 'node:child_process' ).spawn( process.execPath, ${ JSON.stringify(
						watchdogArgs
					) }, { stdio: [ 'ignore', 'ignore', 'ignore', 'ipc' ] } ); setInterval( () => {}, 1000 );`,
				],
				{ stdio: 'ignore' }
			);
			const servesWait = () =>
				spawnSync( 'pgrep', [ '-f', `setInterval\\( \\(\\) => \\{\\}, 1000 \\); // ${ marker }$` ] )
					.status === 0;
			try {
				await vi.waitFor( () => expect( servesWait() ).toBe( true ), { timeout: 5000 } );

				parent.kill( 'SIGKILL' );

				await vi.waitFor( () => expect( servesWait() ).toBe( false ), { timeout: 5000 } );
			} finally {
				parent.kill( 'SIGKILL' );
				for ( const pid of String( spawnSync( 'pgrep', [ '-f', marker ] ).stdout ).split(
					/\s+/
				) ) {
					if ( pid ) {
						process.kill( Number( pid ), 'SIGKILL' );
					}
				}
			}
		},
		15_000
	);

	// Tailscale's macOS installer puts a shell script on PATH that runs the app's
	// binary as its child. Stopping only the script left that binary serving.
	describe.skipIf( process.platform === 'win32' )( 'behind a wrapper script', () => {
		function withWrapper( run: ( wrapper: string, serveRuns: () => boolean ) => Promise< void > ) {
			const folder = mkdtempSync( path.join( tmpdir(), 'studio-serve-wrapper-' ) );
			const wrapper = path.join( folder, 'tailscale' );
			const marker = `studio-serve-wrapper-${ process.pid }-${ Date.now() }`;
			// The line after the command keeps the shell from replacing itself with it.
			writeFileSync(
				wrapper,
				`#!/bin/sh\n"${ process.execPath }" -e "setInterval( () => {}, 1000 ); // ${ marker }"\nexit $?\n`
			);
			chmodSync( wrapper, 0o755 );
			const serveRuns = () => spawnSync( 'pgrep', [ '-f', `// ${ marker }` ] ).status === 0;
			return run( wrapper, serveRuns ).finally( () => {
				for ( const pid of String( spawnSync( 'pgrep', [ '-f', marker ] ).stdout ).split(
					/\s+/
				) ) {
					if ( pid ) {
						process.kill( Number( pid ), 'SIGKILL' );
					}
				}
				rmSync( folder, { recursive: true, force: true } );
			} );
		}

		it( 'ends what the wrapper started when remote mode stops it', async () => {
			await withWrapper( async ( wrapper, serveRuns ) => {
				const watchdog = spawnServe( wrapper, [] );
				await vi.waitFor( () => expect( serveRuns() ).toBe( true ), { timeout: 5000 } );

				watchdog.kill();

				await vi.waitFor( () => expect( serveRuns() ).toBe( false ), { timeout: 5000 } );
			} );
		}, 15_000 );

		it( "ends what the wrapper started when remote mode's stop closes the IPC channel", async () => {
			await withWrapper( async ( wrapper, serveRuns ) => {
				const serve = startTailscaleServe( wrapper, 0 );
				await vi.waitFor( () => expect( serveRuns() ).toBe( true ), { timeout: 5000 } );

				serve.stop();

				await vi.waitFor( () => expect( serveRuns() ).toBe( false ), { timeout: 5000 } );
				await serve.ended;
			} );
		}, 15_000 );

		it( 'ends what the wrapper started when remote mode is killed with SIGKILL', async () => {
			await withWrapper( async ( wrapper, serveRuns ) => {
				const watchdogArgs = [ '-e', SERVE_WATCHDOG, wrapper ];
				const parent = spawn(
					process.execPath,
					[
						'-e',
						`require( 'node:child_process' ).spawn( process.execPath, ${ JSON.stringify(
							watchdogArgs
						) }, { stdio: [ 'ignore', 'ignore', 'ignore', 'ipc' ] } ); setInterval( () => {}, 1000 );`,
					],
					{ stdio: 'ignore' }
				);
				try {
					await vi.waitFor( () => expect( serveRuns() ).toBe( true ), { timeout: 5000 } );

					parent.kill( 'SIGKILL' );

					await vi.waitFor( () => expect( serveRuns() ).toBe( false ), { timeout: 5000 } );
				} finally {
					parent.kill( 'SIGKILL' );
				}
			} );
		}, 15_000 );
	} );
} );
