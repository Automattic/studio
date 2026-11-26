import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDefaultLanAddress } from '@studio/common/lib/network-address';
import { readRemoteServerInfo, setRemoteServerInfo } from '@studio/common/lib/remote-access';
import { readTailscaleState } from '@studio/common/lib/tailscale';
import { startLocalServer } from '@studio/local';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { capturePreview } from 'cli/lib/capture-preview';
import { printPairingCode } from 'cli/lib/remote-pairing';
import { startTailscaleServe, waitForTailscaleHttps } from 'cli/lib/tailscale-serve';
import { mockReportError, mockReportSuccess } from 'cli/tests/test-utils';
import { runCommand } from '../remote/start';

vi.mock( 'cli/logger', () => ( {
	Logger: class {
		reportSuccess = mockReportSuccess;
		reportError = mockReportError;
	},
	LoggerError: class LoggerError extends Error {},
} ) );
// A server that listens where it is told, like the real one.
vi.mock( '@studio/local', () => ( {
	startLocalServer: vi.fn( async ( options: { host: string; port: number } ) => ( {
		url: `http://${ options.host }:${ options.port }`,
		port: options.port,
		close: vi.fn( async () => {} ),
	} ) ),
} ) );
vi.mock( 'cli/lib/remote-pairing', () => ( { printPairingCode: vi.fn() } ) );
vi.mock( '@studio/common/lib/network-address', () => ( {
	getDefaultLanAddress: vi.fn( () => '192.168.1.20' ),
} ) );
vi.mock( '@studio/common/lib/tailscale', () => ( {
	readTailscaleState: vi.fn(),
	findTailscaleCli: vi.fn( () => '/usr/bin/tailscale' ),
} ) );
vi.mock( 'cli/lib/tailscale-serve', () => ( {
	startTailscaleServe: vi.fn(),
	waitForTailscaleHttps: vi.fn(),
} ) );

const TAILSCALE_READY = {
	installed: true as const,
	running: true,
	ipv4: '100.101.102.103',
	dnsName: 'my-mac.tail1234.ts.net',
	httpsReady: true,
};

// A serve child that runs until the test ends it.
function runningServe() {
	let end: ( message?: string ) => void = () => undefined;
	const serve = {
		ended: new Promise< string | undefined >( ( resolve ) => {
			end = resolve;
		} ),
		stop: vi.fn(),
	};
	vi.mocked( startTailscaleServe ).mockReturnValue( serve );
	return { serve, end: ( message?: string ) => end( message ) };
}

let configDir: string;
const originalSend = process.send;

// The test runs in a forked worker, which has an IPC channel: say which way
// `studio remote` was started.
function startedBy( starter: 'terminal' | 'app' ) {
	( process as { send?: unknown } ).send = starter === 'app' ? vi.fn() : undefined;
}

const stopSignals = () =>
	vi
		.mocked( process.on )
		.mock.calls.map( ( [ event ] ) => event )
		.filter( ( event ) => [ 'SIGINT', 'SIGTERM', 'disconnect' ].includes( String( event ) ) );

beforeEach( () => {
	vi.clearAllMocks();
	configDir = mkdtempSync( path.join( os.tmpdir(), 'studio-remote-start-' ) );
	process.env.DEV_CONFIG_DIR = configDir;
	vi.stubGlobal( '__STUDIO_CLI_VERSION__', 'test-version' );
	// The command waits for Ctrl+C; the test does not.
	vi.spyOn( process, 'on' ).mockImplementation( () => process );
	vi.spyOn( process, 'once' ).mockImplementation( () => process );
	vi.spyOn( process, 'off' ).mockImplementation( () => process );
	vi.mocked( readTailscaleState ).mockResolvedValue( { installed: false } );
	vi.mocked( waitForTailscaleHttps ).mockResolvedValue( undefined );
} );

afterEach( () => {
	( process as { send?: unknown } ).send = originalSend;
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	delete process.env.DEV_CONFIG_DIR;
	rmSync( configDir, { recursive: true, force: true } );
} );

it( "gives the server the capture that takes the phone's screenshots", async () => {
	await runCommand( { host: '127.0.0.1', port: 8098 } );

	expect( mockReportError ).not.toHaveBeenCalled();
	expect( startLocalServer ).toHaveBeenCalledWith(
		expect.objectContaining( { host: '127.0.0.1', port: 8098, capturePreview } )
	);
} );

it( 'prints a pairing code and stops on Ctrl+C when started in a terminal', async () => {
	startedBy( 'terminal' );

	await runCommand( { host: '127.0.0.1', port: 8098 } );

	expect( printPairingCode ).toHaveBeenCalledWith( 'http://127.0.0.1:8098' );
	expect( stopSignals() ).toEqual( [ 'SIGINT', 'SIGTERM' ] );
} );

it( 'leaves the codes to the desktop app that started it, and stops when the app goes', async () => {
	startedBy( 'app' );

	await runCommand( { host: '127.0.0.1', port: 8098 } );

	expect( printPairingCode ).not.toHaveBeenCalled();
	expect( stopSignals() ).toEqual( [ 'SIGINT', 'SIGTERM', 'disconnect' ] );
} );

it( 'stops at once when the app that started it went away while it started', async () => {
	startedBy( 'app' );
	const exit = vi.spyOn( process, 'exit' ).mockImplementation( () => undefined as never );
	const connected = process.connected;
	( process as { connected: boolean } ).connected = false;
	try {
		await runCommand( { host: '127.0.0.1', port: 8098 } );
	} finally {
		( process as { connected: boolean } ).connected = connected;
	}

	await vi.waitFor( () => expect( exit ).toHaveBeenCalledWith( 0 ) );
} );

it( 'tells a desktop user with no network address to connect, not to pass --host', async () => {
	startedBy( 'app' );
	vi.mocked( getDefaultLanAddress ).mockReturnValueOnce( undefined );

	await runCommand( {} );

	expect( mockReportError ).toHaveBeenCalledWith(
		expect.objectContaining( {
			message: 'No network address found. Connect this computer to a network, then try again.',
		} )
	);
	expect( startLocalServer ).not.toHaveBeenCalled();
} );

it( 'records the local network connection with the address it listens on', async () => {
	await runCommand( { host: '127.0.0.1', port: 8098 } );

	expect( readTailscaleState ).not.toHaveBeenCalled();
	expect( await readRemoteServerInfo() ).toMatchObject( {
		url: 'http://127.0.0.1:8098',
		connection: 'local',
	} );
} );

it( 'Automatic serves Tailscale HTTPS from loopback when it is ready, and advertises the HTTPS name', async () => {
	startedBy( 'terminal' );
	vi.mocked( readTailscaleState ).mockResolvedValue( TAILSCALE_READY );
	runningServe();

	await runCommand( { port: 8084 } );

	expect( mockReportError ).not.toHaveBeenCalled();
	expect( startLocalServer ).toHaveBeenCalledWith(
		expect.objectContaining( { host: '127.0.0.1', port: 8084 } )
	);
	expect( startTailscaleServe ).toHaveBeenCalledWith( '/usr/bin/tailscale', 8084 );
	expect( waitForTailscaleHttps ).toHaveBeenCalledWith(
		expect.objectContaining( { url: 'https://my-mac.tail1234.ts.net:8084' } )
	);
	expect( await readRemoteServerInfo() ).toMatchObject( {
		url: 'https://my-mac.tail1234.ts.net:8084',
		connection: 'https',
	} );
	expect( printPairingCode ).toHaveBeenCalledWith( 'https://my-mac.tail1234.ts.net:8084' );
} );

it( 'refuses Tailscale HTTPS asked for by name when the tailnet has no HTTPS, and says why', async () => {
	vi.mocked( readTailscaleState ).mockResolvedValue( { ...TAILSCALE_READY, httpsReady: false } );

	await runCommand( { connection: 'https', port: 8084 } );

	expect( mockReportError ).toHaveBeenCalledWith(
		expect.objectContaining( {
			message: 'HTTPS is not turned on for your tailnet in Tailscale.',
		} )
	);
	expect( startLocalServer ).not.toHaveBeenCalled();
} );

it( 'refuses --host with a connection through Tailscale', async () => {
	await runCommand( { host: '127.0.0.1', connection: 'tailnet' } );

	expect( mockReportError ).toHaveBeenCalledWith(
		expect.objectContaining( {
			message: '--host works only with the local network connection.',
		} )
	);
	expect( startLocalServer ).not.toHaveBeenCalled();
} );

it( 'stops tailscale serve and the server when Tailscale HTTPS does not answer', async () => {
	vi.mocked( readTailscaleState ).mockResolvedValue( TAILSCALE_READY );
	const { serve } = runningServe();
	vi.mocked( waitForTailscaleHttps ).mockRejectedValue(
		new Error(
			'No answer at https://my-mac.tail1234.ts.net:8084 within 60 seconds (certificate not yet valid).'
		)
	);
	const close = vi.fn( async () => {} );
	vi.mocked( startLocalServer ).mockResolvedValueOnce( {
		url: 'http://127.0.0.1:8084',
		port: 8084,
		close,
	} as unknown as Awaited< ReturnType< typeof startLocalServer > > );

	await runCommand( { connection: 'https', port: 8084 } );

	expect( serve.stop ).toHaveBeenCalled();
	expect( close ).toHaveBeenCalled();
	expect( mockReportError ).toHaveBeenCalledWith(
		expect.objectContaining( {
			message:
				'Tailscale HTTPS did not start. No answer at https://my-mac.tail1234.ts.net:8084 within 60 seconds (certificate not yet valid).',
		} )
	);
	expect( await readRemoteServerInfo() ).toBeUndefined();
} );

it( 'stops with the reason when tailscale serve ends while remote mode runs', async () => {
	vi.mocked( readTailscaleState ).mockResolvedValue( TAILSCALE_READY );
	const { end } = runningServe();
	const exit = vi.spyOn( process, 'exit' ).mockImplementation( () => undefined as never );

	await runCommand( { connection: 'https', port: 8084 } );
	end( 'serve config changed by another client' );

	await vi.waitFor( () => expect( exit ).toHaveBeenCalledWith( 1 ) );
	expect( mockReportError ).toHaveBeenCalledWith(
		expect.objectContaining( {
			message: 'Tailscale HTTPS stopped: serve config changed by another client',
		} )
	);
} );

it( 'stops the tailnet connection when Tailscale is signed out at two checks in a row, not one', async () => {
	vi.useFakeTimers();
	try {
		const SIGNED_OUT = { installed: true as const, running: false, httpsReady: false };
		vi.mocked( readTailscaleState )
			.mockResolvedValueOnce( { ...TAILSCALE_READY, httpsReady: false } )
			.mockResolvedValueOnce( SIGNED_OUT )
			.mockResolvedValueOnce( { ...TAILSCALE_READY, httpsReady: false } )
			.mockResolvedValue( SIGNED_OUT );
		const exit = vi.spyOn( process, 'exit' ).mockImplementation( () => undefined as never );

		await runCommand( { port: 8084 } );
		expect( startLocalServer ).toHaveBeenCalledWith(
			expect.objectContaining( { host: '100.101.102.103' } )
		);
		await vi.advanceTimersByTimeAsync( 60_000 );
		// One signed-out check, then a good one: still running.
		expect( mockReportError ).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync( 60_000 );

		await vi.waitFor( () => expect( exit ).toHaveBeenCalledWith( 1 ) );
		expect( mockReportError ).toHaveBeenCalledWith(
			expect.objectContaining( { message: 'Tailscale is not running, or not signed in.' } )
		);
	} finally {
		vi.useRealTimers();
	}
} );

it( "stops when this computer's address on the tailnet changes", async () => {
	vi.useFakeTimers();
	try {
		vi.mocked( readTailscaleState )
			.mockResolvedValueOnce( { ...TAILSCALE_READY, httpsReady: false } )
			.mockResolvedValue( { ...TAILSCALE_READY, httpsReady: false, ipv4: '100.90.1.2' } );
		const exit = vi.spyOn( process, 'exit' ).mockImplementation( () => undefined as never );

		await runCommand( { port: 8084 } );
		await vi.advanceTimersByTimeAsync( 60_000 );

		await vi.waitFor( () => expect( exit ).toHaveBeenCalledWith( 1 ) );
		expect( mockReportError ).toHaveBeenCalledWith(
			expect.objectContaining( { message: "This computer's address on the tailnet changed." } )
		);
	} finally {
		vi.useRealTimers();
	}
} );

it( 'is ready to stop before it starts anything, and a crash still ends tailscale serve', async () => {
	startedBy( 'terminal' );
	vi.mocked( readTailscaleState ).mockResolvedValue( TAILSCALE_READY );
	const { serve } = runningServe();
	let signalsAtStart: unknown[] = [];
	vi.mocked( startLocalServer ).mockImplementationOnce( async ( options ) => {
		signalsAtStart = stopSignals();
		return {
			url: `http://${ options.host }:${ options.port }`,
			port: options.port,
			close: vi.fn( async () => {} ),
		} as unknown as Awaited< ReturnType< typeof startLocalServer > >;
	} );

	await runCommand( { connection: 'https', port: 8084 } );

	expect( signalsAtStart ).toEqual( [ 'SIGINT', 'SIGTERM' ] );
	const exitHook = vi
		.mocked( process.once )
		.mock.calls.find( ( [ event ] ) => event === 'exit' )?.[ 1 ] as ( () => void ) | undefined;
	exitHook?.();
	expect( serve.stop ).toHaveBeenCalled();
} );

it( 'ends tailscale serve and the server on Ctrl+C while it waits for HTTPS', async () => {
	startedBy( 'terminal' );
	vi.mocked( readTailscaleState ).mockResolvedValue( TAILSCALE_READY );
	const { serve, end } = runningServe();
	vi.mocked( waitForTailscaleHttps ).mockImplementation( async ( { ended } ) => {
		const message = await ended;
		throw new Error( message ?? 'tailscale serve stopped.' );
	} );
	serve.stop.mockImplementation( () => end() );
	const exit = vi.spyOn( process, 'exit' ).mockImplementation( () => undefined as never );

	const running = runCommand( { connection: 'https', port: 8084 } );
	await vi.waitFor( () => expect( waitForTailscaleHttps ).toHaveBeenCalled() );
	const sigint = vi
		.mocked( process.on )
		.mock.calls.find( ( [ event ] ) => event === 'SIGINT' )?.[ 1 ] as ( () => void ) | undefined;
	sigint?.();
	await running;

	expect( serve.stop ).toHaveBeenCalled();
	const server = await vi.mocked( startLocalServer ).mock.results[ 0 ].value;
	expect( server.close ).toHaveBeenCalled();
	await vi.waitFor( () => expect( exit ).toHaveBeenCalledWith( 0 ) );
	expect( await readRemoteServerInfo() ).toBeUndefined();
} );

it( 'Automatic takes the tailnet when Tailscale HTTPS does not start, and says why', async () => {
	startedBy( 'terminal' );
	vi.mocked( readTailscaleState ).mockResolvedValue( TAILSCALE_READY );
	const { serve } = runningServe();
	vi.mocked( waitForTailscaleHttps ).mockRejectedValue(
		new Error( 'error enabling https feature: Access denied: serve config denied' )
	);
	const log = vi.spyOn( console, 'log' ).mockImplementation( () => {} );

	await runCommand( { port: 8084 } );

	expect( serve.stop ).toHaveBeenCalled();
	expect( vi.mocked( startLocalServer ).mock.calls.map( ( [ options ] ) => options.host ) ).toEqual(
		[ '127.0.0.1', '100.101.102.103' ]
	);
	const first = await vi.mocked( startLocalServer ).mock.results[ 0 ].value;
	expect( first.close ).toHaveBeenCalled();
	expect( await readRemoteServerInfo() ).toMatchObject( {
		url: 'http://100.101.102.103:8084',
		connection: 'tailnet',
	} );
	expect( log ).toHaveBeenCalledWith(
		'Tailscale HTTPS did not start. error enabling https feature: Access denied: serve config denied'
	);
	expect( mockReportError ).not.toHaveBeenCalled();
	// The desktop app shows it under the connection.
	expect( await readRemoteServerInfo() ).toMatchObject( {
		fallbackReason:
			'Tailscale HTTPS did not start. error enabling https feature: Access denied: serve config denied',
	} );
} );

it( 'Automatic takes the next connection when one cannot listen, and says why', async () => {
	startedBy( 'terminal' );
	vi.mocked( readTailscaleState ).mockResolvedValue( TAILSCALE_READY );
	runningServe();
	// Another program holds the port on loopback only.
	vi.mocked( startLocalServer ).mockRejectedValueOnce(
		new Error( 'listen EADDRINUSE: address already in use 127.0.0.1:8084' )
	);
	const log = vi.spyOn( console, 'log' ).mockImplementation( () => {} );

	await runCommand( { port: 8084 } );

	expect( vi.mocked( startLocalServer ).mock.calls.map( ( [ options ] ) => options.host ) ).toEqual(
		[ '127.0.0.1', '100.101.102.103' ]
	);
	expect( startTailscaleServe ).not.toHaveBeenCalled();
	expect( await readRemoteServerInfo() ).toMatchObject( {
		url: 'http://100.101.102.103:8084',
		connection: 'tailnet',
		fallbackReason:
			'Tailscale HTTPS did not start. listen EADDRINUSE: address already in use 127.0.0.1:8084',
	} );
	expect( log ).toHaveBeenCalledWith(
		'Tailscale HTTPS did not start. listen EADDRINUSE: address already in use 127.0.0.1:8084'
	);
	expect( mockReportError ).not.toHaveBeenCalled();
} );

it( 'fails with the reason when a connection asked for by name cannot listen', async () => {
	startedBy( 'terminal' );
	vi.mocked( startLocalServer ).mockRejectedValueOnce(
		new Error( 'listen EADDRINUSE: address already in use 192.168.1.20:8084' )
	);

	await runCommand( { connection: 'local', port: 8084 } );

	expect( startLocalServer ).toHaveBeenCalledTimes( 1 );
	expect( mockReportError ).toHaveBeenCalledTimes( 1 );
	expect( await readRemoteServerInfo() ).toBeUndefined();
} );

it.each( [
	[ '--port 65536', { port: 65536 }, undefined ],
	[ 'a port that is not a number', {}, 'eighty' ],
] )( 'refuses %s before it starts anything', async ( _name, options, environment ) => {
	startedBy( 'terminal' );
	vi.stubEnv( 'STUDIO_REMOTE_SERVER_PORT', environment );

	await runCommand( options );

	expect( startLocalServer ).not.toHaveBeenCalled();
	expect( mockReportError ).toHaveBeenCalledWith(
		expect.objectContaining( { message: 'The port must be a whole number from 0 to 65535.' } )
	);
	vi.unstubAllEnvs();
} );

it( 'takes its stop listeners off when a start fails, so it ends and the app hears why', async () => {
	startedBy( 'app' );
	vi.mocked( readTailscaleState ).mockResolvedValue( TAILSCALE_READY );
	runningServe();
	vi.mocked( waitForTailscaleHttps ).mockRejectedValue( new Error( 'tailscale serve stopped.' ) );

	await runCommand( { connection: 'https', port: 8084 } );

	expect( mockReportError ).toHaveBeenCalled();
	// A `disconnect` listener would keep the IPC channel, and so the process, alive.
	for ( const event of [ 'SIGINT', 'SIGTERM', 'disconnect' ] ) {
		const added = vi.mocked( process.on ).mock.calls.find( ( [ name ] ) => name === event );
		expect( process.off ).toHaveBeenCalledWith( event, added?.[ 1 ] );
	}
} );

it( 'writes no record when it is stopped while its server starts', async () => {
	startedBy( 'terminal' );
	const exit = vi.spyOn( process, 'exit' ).mockImplementation( () => undefined as never );
	vi.mocked( startLocalServer ).mockImplementationOnce( async ( options ) => {
		const sigint = vi
			.mocked( process.on )
			.mock.calls.find( ( [ event ] ) => event === 'SIGINT' )?.[ 1 ] as ( () => void ) | undefined;
		sigint?.();
		return {
			url: `http://${ options.host }:${ options.port }`,
			port: options.port,
			close: vi.fn( async () => {} ),
		} as unknown as Awaited< ReturnType< typeof startLocalServer > >;
	} );

	await runCommand( { host: '127.0.0.1', port: 8098 } );

	await vi.waitFor( () => expect( exit ).toHaveBeenCalledWith( 0 ) );
	expect( await readRemoteServerInfo() ).toBeUndefined();
	expect( printPairingCode ).not.toHaveBeenCalled();
} );

it( 'serves HTTPS on the port the server got', async () => {
	vi.mocked( readTailscaleState ).mockResolvedValue( TAILSCALE_READY );
	runningServe();
	vi.mocked( startLocalServer ).mockResolvedValueOnce( {
		url: 'http://127.0.0.1:54321',
		port: 54321,
		close: vi.fn( async () => {} ),
	} as unknown as Awaited< ReturnType< typeof startLocalServer > > );

	await runCommand( { connection: 'https', port: 0 } );

	expect( startTailscaleServe ).toHaveBeenCalledWith( '/usr/bin/tailscale', 54321 );
	expect( await readRemoteServerInfo() ).toMatchObject( {
		url: 'https://my-mac.tail1234.ts.net:54321',
	} );
} );

it( 'leaves the record to a remote mode that started while this one waited for HTTPS', async () => {
	vi.mocked( readTailscaleState ).mockResolvedValue( TAILSCALE_READY );
	const { serve } = runningServe();
	// The parent of this test process: alive, and not this process.
	vi.mocked( waitForTailscaleHttps ).mockImplementation( async () => {
		await setRemoteServerInfo( {
			url: 'http://192.168.1.20:8082',
			pid: process.ppid,
			connection: 'local',
		} );
	} );

	await runCommand( { connection: 'https', port: 8084 } );

	expect( mockReportError ).toHaveBeenCalledWith(
		expect.objectContaining( {
			message: 'Remote mode is already running at http://192.168.1.20:8082.',
		} )
	);
	expect( serve.stop ).toHaveBeenCalled();
	expect( await readRemoteServerInfo() ).toMatchObject( { pid: process.ppid } );
} );
