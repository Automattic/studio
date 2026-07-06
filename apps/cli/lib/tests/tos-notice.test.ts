import fs from 'fs';
import { getCliConfigPath } from '@studio/common/lib/well-known-paths';
import { type MockInstance, vi } from 'vitest';
import { updateCliConfigWithPartial } from 'cli/lib/cli-config/core';
import {
	formatTosNoticeLines,
	maybeShowTosNotice,
	setupTosNotice,
	PRIVACY_POLICY_URL,
	TOS_URL,
} from 'cli/lib/tos-notice';

vi.mock( 'cli/lib/cli-config/core', async ( importOriginal ) => ( {
	...( await importOriginal< object >() ),
	updateCliConfigWithPartial: vi.fn().mockResolvedValue( undefined ),
} ) );

// eslint-disable-next-line no-control-regex
const strip = ( s: string ) => s.replace( /\u001B\[[0-9;]*m/g, '' );

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

describe( 'formatTosNoticeLines', () => {
	it( 'includes the ToS and Privacy Policy URLs', () => {
		const plain = strip( formatTosNoticeLines().join( '\n' ) );
		expect( plain ).toContain( TOS_URL );
		expect( plain ).toContain( PRIVACY_POLICY_URL );
	} );

	it( 'mentions Terms of Service and Privacy Policy', () => {
		const plain = strip( formatTosNoticeLines().join( '\n' ) );
		expect( plain ).toContain( 'Terms of Service' );
		expect( plain ).toContain( 'Privacy Policy' );
	} );
} );

describe( 'setupTosNotice', () => {
	const originalSend = process.send;
	const originalArgv = process.argv;
	let stderrWriteSpy: MockInstance;
	let readFileSyncSpy: MockInstance;

	beforeEach( () => {
		stderrWriteSpy = vi.spyOn( process.stderr, 'write' ).mockImplementation( () => true );
		// Simulate "flag not set" without touching the real ~/.studio/cli.json
		readFileSyncSpy = vi.spyOn( fs, 'readFileSync' ).mockImplementation( ( file ) => {
			if ( file === getCliConfigPath() ) {
				return JSON.stringify( { version: 1, sites: [], snapshots: [] } );
			}
			throw new Error( `Unexpected readFileSync: ${ String( file ) }` );
		} );
		process.argv = [ 'node', 'studio', 'auth', 'status' ];
		// In vitest fork pool, process.send is defined (IPC with the runner).
		// Clear it so the IPC-mode guard doesn't suppress the banner in non-IPC tests.
		process.send = undefined;
		// stderr is piped in the test runner, so isTTY is falsy; the banner only
		// renders on a visible terminal.
		setStderrIsTTY( true );
		vi.mocked( updateCliConfigWithPartial ).mockClear();
	} );

	afterEach( () => {
		process.send = originalSend;
		process.argv = originalArgv;
		restoreStderrIsTTY();
		stderrWriteSpy.mockRestore();
		readFileSyncSpy.mockRestore();
	} );

	it( 'shows the banner and persists the flag on first run', async () => {
		await setupTosNotice();
		expect( stderrWriteSpy ).toHaveBeenCalled();
		expect( updateCliConfigWithPartial ).toHaveBeenCalledWith(
			expect.objectContaining( { tosNoticeShownAt: expect.any( Number ) } )
		);
	} );

	it( 'shows the banner and persists the flag when the config file does not exist', async () => {
		readFileSyncSpy.mockImplementation( () => {
			throw Object.assign( new Error( 'ENOENT' ), { code: 'ENOENT' } );
		} );
		await setupTosNotice();
		expect( stderrWriteSpy ).toHaveBeenCalled();
		expect( updateCliConfigWithPartial ).toHaveBeenCalledWith(
			expect.objectContaining( { tosNoticeShownAt: expect.any( Number ) } )
		);
	} );

	it( 'does nothing when the notice was already shown', async () => {
		readFileSyncSpy.mockReturnValue(
			JSON.stringify( { version: 1, sites: [], snapshots: [], tosNoticeShownAt: 123 } )
		);
		await setupTosNotice();
		expect( stderrWriteSpy ).not.toHaveBeenCalled();
		expect( updateCliConfigWithPartial ).not.toHaveBeenCalled();
	} );

	it( 'does nothing in IPC mode', async () => {
		process.send = vi.fn();
		await setupTosNotice();
		expect( stderrWriteSpy ).not.toHaveBeenCalled();
		expect( updateCliConfigWithPartial ).not.toHaveBeenCalled();
	} );

	it( 'skips the stderr banner for the code/ai commands (TUI renders it)', async () => {
		process.argv = [ 'node', 'studio', 'code' ];
		await setupTosNotice();
		expect( stderrWriteSpy ).not.toHaveBeenCalled();
		expect( updateCliConfigWithPartial ).not.toHaveBeenCalled();
	} );

	it( 'does not throw when persisting the flag fails', async () => {
		vi.mocked( updateCliConfigWithPartial ).mockRejectedValueOnce( new Error( 'locked' ) );
		await expect( setupTosNotice() ).resolves.toBeUndefined();
		expect( stderrWriteSpy ).toHaveBeenCalled();
	} );

	it( 'does nothing when stderr is not a TTY', async () => {
		setStderrIsTTY( undefined );
		await setupTosNotice();
		expect( stderrWriteSpy ).not.toHaveBeenCalled();
		expect( updateCliConfigWithPartial ).not.toHaveBeenCalled();
	} );

	it( 'does not persist the flag when writing the banner throws (e.g. EPIPE)', async () => {
		stderrWriteSpy.mockImplementation( () => {
			throw Object.assign( new Error( 'broken pipe' ), { code: 'EPIPE' } );
		} );
		await expect( setupTosNotice() ).resolves.toBeUndefined();
		expect( updateCliConfigWithPartial ).not.toHaveBeenCalled();
	} );
} );

describe( 'maybeShowTosNotice', () => {
	const originalSend = process.send;
	const originalRemoteSession = process.env.STUDIO_REMOTE_SESSION;
	let readFileSyncSpy: MockInstance;

	beforeEach( () => {
		// Simulate "flag not set" without touching the real ~/.studio/cli.json
		readFileSyncSpy = vi.spyOn( fs, 'readFileSync' ).mockImplementation( ( file ) => {
			if ( file === getCliConfigPath() ) {
				return JSON.stringify( { version: 1, sites: [], snapshots: [] } );
			}
			throw new Error( `Unexpected readFileSync: ${ String( file ) }` );
		} );
		// In vitest fork pool, process.send is defined (IPC with the runner).
		// Clear it so the IPC-mode guard doesn't suppress the notice in non-IPC tests.
		process.send = undefined;
		delete process.env.STUDIO_REMOTE_SESSION;
		// stderr is piped in the test runner, so isTTY is falsy; the notice only
		// renders on a visible terminal.
		setStderrIsTTY( true );
		vi.mocked( updateCliConfigWithPartial ).mockClear();
	} );

	afterEach( () => {
		process.send = originalSend;
		if ( originalRemoteSession === undefined ) {
			delete process.env.STUDIO_REMOTE_SESSION;
		} else {
			process.env.STUDIO_REMOTE_SESSION = originalRemoteSession;
		}
		restoreStderrIsTTY();
		readFileSyncSpy.mockRestore();
	} );

	it( 'renders the notice and persists the flag on first run', async () => {
		const render = vi.fn();
		await maybeShowTosNotice( render );
		expect( render ).toHaveBeenCalledTimes( 1 );
		expect( updateCliConfigWithPartial ).toHaveBeenCalledWith(
			expect.objectContaining( { tosNoticeShownAt: expect.any( Number ) } )
		);
	} );

	it( 'does nothing when the notice was already shown', async () => {
		readFileSyncSpy.mockReturnValue(
			JSON.stringify( { version: 1, sites: [], snapshots: [], tosNoticeShownAt: 123 } )
		);
		const render = vi.fn();
		await maybeShowTosNotice( render );
		expect( render ).not.toHaveBeenCalled();
		expect( updateCliConfigWithPartial ).not.toHaveBeenCalled();
	} );

	it( 'does nothing in IPC mode (spawned by the desktop app)', async () => {
		process.send = vi.fn();
		const render = vi.fn();
		await maybeShowTosNotice( render );
		expect( render ).not.toHaveBeenCalled();
		expect( updateCliConfigWithPartial ).not.toHaveBeenCalled();
	} );

	it( 'does nothing during a remote-session daemon turn', async () => {
		process.env.STUDIO_REMOTE_SESSION = '1';
		const render = vi.fn();
		await maybeShowTosNotice( render );
		expect( render ).not.toHaveBeenCalled();
		expect( updateCliConfigWithPartial ).not.toHaveBeenCalled();
	} );

	it( 'does nothing when stderr is not a TTY', async () => {
		setStderrIsTTY( undefined );
		const render = vi.fn();
		await maybeShowTosNotice( render );
		expect( render ).not.toHaveBeenCalled();
		expect( updateCliConfigWithPartial ).not.toHaveBeenCalled();
	} );
} );
