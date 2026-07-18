import { type MockInstance, vi } from 'vitest';
import { readCliConfig } from 'cli/lib/cli-config/core';
import {
	areNotificationsEnabled,
	isNotificationCapableTerminal,
	notifyTerminal,
} from 'cli/lib/notify';

vi.mock( 'cli/lib/cli-config/core', () => ( {
	readCliConfig: vi.fn(),
	updateCliConfigWithPartial: vi.fn().mockResolvedValue( undefined ),
} ) );

const originalTermProgram = process.env.TERM_PROGRAM;
const originalTerm = process.env.TERM;

function setTerminalEnv( termProgram: string | undefined, term: string | undefined ): void {
	if ( termProgram === undefined ) {
		delete process.env.TERM_PROGRAM;
	} else {
		process.env.TERM_PROGRAM = termProgram;
	}
	if ( term === undefined ) {
		delete process.env.TERM;
	} else {
		process.env.TERM = term;
	}
}

function restoreTerminalEnv(): void {
	setTerminalEnv( originalTermProgram, originalTerm );
}

describe( 'isNotificationCapableTerminal', () => {
	afterEach( restoreTerminalEnv );

	it( 'is true for a known TERM_PROGRAM (e.g. Warp)', () => {
		setTerminalEnv( 'WarpTerminal', undefined );
		expect( isNotificationCapableTerminal() ).toBe( true );
	} );

	it( 'is true for Ghostty via its lowercase TERM_PROGRAM value or via TERM', () => {
		setTerminalEnv( 'ghostty', undefined );
		expect( isNotificationCapableTerminal() ).toBe( true );

		setTerminalEnv( undefined, 'xterm-ghostty' );
		expect( isNotificationCapableTerminal() ).toBe( true );
	} );

	it( 'is true for Kitty, which identifies via TERM instead of TERM_PROGRAM', () => {
		setTerminalEnv( undefined, 'xterm-kitty' );
		expect( isNotificationCapableTerminal() ).toBe( true );
	} );

	it( 'is false for an unrecognized or absent terminal', () => {
		setTerminalEnv( undefined, 'xterm-256color' );
		expect( isNotificationCapableTerminal() ).toBe( false );
	} );
} );

describe( 'areNotificationsEnabled', () => {
	beforeEach( () => {
		vi.mocked( readCliConfig ).mockReset();
	} );
	afterEach( restoreTerminalEnv );

	it( 'falls back to terminal detection when the flag is unset', async () => {
		vi.mocked( readCliConfig ).mockResolvedValue( { version: 1, sites: [], snapshots: [] } );
		setTerminalEnv( 'WarpTerminal', undefined );
		expect( await areNotificationsEnabled() ).toBe( true );

		setTerminalEnv( undefined, 'xterm-256color' );
		expect( await areNotificationsEnabled() ).toBe( false );
	} );

	it( 'an explicit flag overrides terminal detection either way', async () => {
		setTerminalEnv( undefined, 'xterm-256color' );
		vi.mocked( readCliConfig ).mockResolvedValue( {
			version: 1,
			sites: [],
			snapshots: [],
			notificationsEnabled: true,
		} );
		expect( await areNotificationsEnabled() ).toBe( true );

		setTerminalEnv( 'WarpTerminal', undefined );
		vi.mocked( readCliConfig ).mockResolvedValue( {
			version: 1,
			sites: [],
			snapshots: [],
			notificationsEnabled: false,
		} );
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
		restoreTerminalEnv();
		stderrWriteSpy.mockRestore();
	} );

	it( 'writes nothing when the flag is unset on an unrecognized terminal', async () => {
		setTerminalEnv( undefined, 'xterm-256color' );
		vi.mocked( readCliConfig ).mockResolvedValue( { version: 1, sites: [], snapshots: [] } );
		await notifyTerminal( 'hello' );
		expect( stderrWriteSpy ).not.toHaveBeenCalled();
	} );

	it( 'writes the OSC9 sequence when the flag is unset but the terminal is capable', async () => {
		setTerminalEnv( 'WarpTerminal', undefined );
		vi.mocked( readCliConfig ).mockResolvedValue( { version: 1, sites: [], snapshots: [] } );
		await notifyTerminal( 'hello' );
		expect( stderrWriteSpy ).toHaveBeenCalledWith( '\x1b]9;hello\x07' );
	} );

	it( 'writes only the OSC9 sequence (no bare BEL) when enabled', async () => {
		vi.mocked( readCliConfig ).mockResolvedValue( {
			version: 1,
			sites: [],
			snapshots: [],
			notificationsEnabled: true,
		} );
		await notifyTerminal( 'Studio Code response is ready' );
		expect( stderrWriteSpy ).toHaveBeenCalledWith( '\x1b]9;Studio Code response is ready\x07' );
		expect( stderrWriteSpy ).toHaveBeenCalledTimes( 1 );
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
