import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startLocalServer } from '@studio/local';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { capturePreview } from 'cli/lib/capture-preview';
import { getDefaultLanAddress } from 'cli/lib/network-address';
import { printPairingCode } from 'cli/lib/remote-pairing';
import { mockReportError, mockReportSuccess } from 'cli/tests/test-utils';
import { runCommand } from '../remote/start';

vi.mock( 'cli/logger', () => ( {
	Logger: class {
		reportSuccess = mockReportSuccess;
		reportError = mockReportError;
	},
	LoggerError: class LoggerError extends Error {},
} ) );
vi.mock( '@studio/local', () => ( {
	startLocalServer: vi.fn().mockResolvedValue( { url: 'http://127.0.0.1:8098', close: vi.fn() } ),
} ) );
vi.mock( 'cli/lib/remote-pairing', () => ( { printPairingCode: vi.fn() } ) );
vi.mock( 'cli/lib/network-address', () => ( {
	getDefaultLanAddress: vi.fn( () => '192.168.1.20' ),
} ) );

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
