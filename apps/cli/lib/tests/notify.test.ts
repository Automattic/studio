import { type MockInstance, vi } from 'vitest';
import { readCliConfig } from 'cli/lib/cli-config/core';
import { areNotificationsEnabled, notifyTerminal } from 'cli/lib/notify';

vi.mock( 'cli/lib/cli-config/core', () => ( {
	readCliConfig: vi.fn(),
	updateCliConfigWithPartial: vi.fn().mockResolvedValue( undefined ),
} ) );

describe( 'areNotificationsEnabled', () => {
	beforeEach( () => {
		vi.mocked( readCliConfig ).mockReset();
	} );

	it( 'is false by default (flag absent from config)', async () => {
		vi.mocked( readCliConfig ).mockResolvedValue( { version: 1, sites: [], snapshots: [] } );
		expect( await areNotificationsEnabled() ).toBe( false );
	} );
} );

describe( 'notifyTerminal', () => {
	const originalSend = process.send;
	let stderrWriteSpy: MockInstance;

	// process.stderr.isTTY is a plain own property (absent when stdio is piped,
	// as in the test runner). Override it per-test and restore the original shape.
	const originalIsTTYDescriptor = Object.getOwnPropertyDescriptor( process.stderr, 'isTTY' );

	function setStderrIsTTY( value: boolean | undefined ): void {
		Object.defineProperty( process.stderr, 'isTTY', { value, configurable: true, writable: true } );
	}

	function restoreStderrIsTTY(): void {
		if ( originalIsTTYDescriptor ) {
			Object.defineProperty( process.stderr, 'isTTY', originalIsTTYDescriptor );
		} else {
			delete ( process.stderr as { isTTY?: boolean } ).isTTY;
		}
	}

	beforeEach( () => {
		process.send = undefined;
		stderrWriteSpy = vi.spyOn( process.stderr, 'write' ).mockImplementation( () => true );
		setStderrIsTTY( true );
		vi.mocked( readCliConfig ).mockReset();
	} );

	afterEach( () => {
		process.send = originalSend;
		restoreStderrIsTTY();
		stderrWriteSpy.mockRestore();
	} );

	it( 'writes nothing when notifications are disabled (default)', async () => {
		vi.mocked( readCliConfig ).mockResolvedValue( { version: 1, sites: [], snapshots: [] } );
		await notifyTerminal( 'hello' );
		expect( stderrWriteSpy ).not.toHaveBeenCalled();
	} );

	it( 'writes the OSC9 + BEL sequence when notifications are enabled', async () => {
		vi.mocked( readCliConfig ).mockResolvedValue( {
			version: 1,
			sites: [],
			snapshots: [],
			notificationsEnabled: true,
		} );
		await notifyTerminal( 'Studio Code response is ready' );
		expect( stderrWriteSpy ).toHaveBeenCalledWith( '\x1b]9;Studio Code response is ready\x07' );
		expect( stderrWriteSpy ).toHaveBeenCalledWith( '\x07' );
	} );

	it( 'stays silent when forked by the desktop app over IPC, even if enabled', async () => {
		process.send = vi.fn();
		vi.mocked( readCliConfig ).mockResolvedValue( {
			version: 1,
			sites: [],
			snapshots: [],
			notificationsEnabled: true,
		} );
		await notifyTerminal( 'hello' );
		expect( stderrWriteSpy ).not.toHaveBeenCalled();
		// The IPC guard short-circuits before the config is even read.
		expect( readCliConfig ).not.toHaveBeenCalled();
	} );

	it( 'stays silent when stderr is not a TTY (piped/redirected), even if enabled', async () => {
		setStderrIsTTY( undefined );
		vi.mocked( readCliConfig ).mockResolvedValue( {
			version: 1,
			sites: [],
			snapshots: [],
			notificationsEnabled: true,
		} );
		await notifyTerminal( 'hello' );
		expect( stderrWriteSpy ).not.toHaveBeenCalled();
		// The TTY guard short-circuits before the config is even read.
		expect( readCliConfig ).not.toHaveBeenCalled();
	} );

	it( 'never throws when reading the config fails', async () => {
		vi.mocked( readCliConfig ).mockRejectedValue( new Error( 'locked' ) );
		await expect( notifyTerminal( 'hello' ) ).resolves.toBeUndefined();
		expect( stderrWriteSpy ).not.toHaveBeenCalled();
	} );
} );
