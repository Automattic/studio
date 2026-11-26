import fs from 'fs';
import os from 'os';
import path from 'path';
import { getConfigPath, readConfigSync, updateConfig } from '@studio/common/lib/config/store';
import { type MockInstance, vi } from 'vitest';
import {
	formatTosNoticeLines,
	maybeShowTosNotice,
	setupTosNotice,
	PRIVACY_POLICY_URL,
	TOS_URL,
} from 'cli/lib/tos-notice';

vi.mock( '@studio/common/lib/config/store', async ( importOriginal ) => {
	const actual = await importOriginal< typeof import('@studio/common/lib/config/store') >();
	return { ...actual, updateConfig: vi.fn( actual.updateConfig ) };
} );

const shownAt = () => readConfigSync().cli.tosNoticeShownAt;

function markShown() {
	fs.writeFileSync(
		getConfigPath(),
		JSON.stringify( { version: 1, cli: { tosNoticeShownAt: 123 } } )
	);
}

beforeEach( () => {
	process.env.DEV_CONFIG_DIR = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-tos-' ) );
	vi.mocked( updateConfig ).mockClear();
} );

afterEach( () => {
	fs.rmSync( process.env.DEV_CONFIG_DIR!, { recursive: true, force: true } );
	delete process.env.DEV_CONFIG_DIR;
} );

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
} );

describe( 'setupTosNotice', () => {
	const originalSend = process.send;
	const originalArgv = process.argv;
	let stderrWriteSpy: MockInstance;

	beforeEach( () => {
		stderrWriteSpy = vi.spyOn( process.stderr, 'write' ).mockImplementation( () => true );
		process.argv = [ 'node', 'studio', 'auth', 'status' ];
		// In vitest fork pool, process.send is defined (IPC with the runner).
		// Clear it so the IPC-mode guard doesn't suppress the banner in non-IPC tests.
		process.send = undefined;
		// stderr is piped in the test runner, so isTTY is falsy; the banner only
		// renders on a visible terminal.
		setStderrIsTTY( true );
	} );

	afterEach( () => {
		process.send = originalSend;
		process.argv = originalArgv;
		restoreStderrIsTTY();
		stderrWriteSpy.mockRestore();
	} );

	it( 'shows the banner and persists the flag on first run', async () => {
		await setupTosNotice();
		expect( stderrWriteSpy ).toHaveBeenCalled();
		expect( shownAt() ).toEqual( expect.any( Number ) );
	} );

	it( 'does nothing when the notice was already shown', async () => {
		markShown();
		await setupTosNotice();
		expect( stderrWriteSpy ).not.toHaveBeenCalled();
		expect( updateConfig ).not.toHaveBeenCalled();
	} );

	it( 'does nothing in IPC mode', async () => {
		process.send = vi.fn();
		await setupTosNotice();
		expect( stderrWriteSpy ).not.toHaveBeenCalled();
		expect( updateConfig ).not.toHaveBeenCalled();
	} );

	it( 'skips the stderr banner for the code/ai commands (TUI renders it)', async () => {
		process.argv = [ 'node', 'studio', 'code' ];
		await setupTosNotice();
		expect( stderrWriteSpy ).not.toHaveBeenCalled();
		expect( updateConfig ).not.toHaveBeenCalled();
	} );

	it( 'does not throw when persisting the flag fails', async () => {
		vi.mocked( updateConfig ).mockRejectedValueOnce( new Error( 'locked' ) );
		await expect( setupTosNotice() ).resolves.toBeUndefined();
		expect( stderrWriteSpy ).toHaveBeenCalled();
	} );

	it( 'does nothing when stderr is not a TTY', async () => {
		setStderrIsTTY( undefined );
		await setupTosNotice();
		expect( stderrWriteSpy ).not.toHaveBeenCalled();
		expect( updateConfig ).not.toHaveBeenCalled();
	} );

	it( 'does not persist the flag when writing the banner throws (e.g. EPIPE)', async () => {
		stderrWriteSpy.mockImplementation( () => {
			throw Object.assign( new Error( 'broken pipe' ), { code: 'EPIPE' } );
		} );
		await expect( setupTosNotice() ).resolves.toBeUndefined();
		expect( updateConfig ).not.toHaveBeenCalled();
	} );
} );

describe( 'maybeShowTosNotice', () => {
	const originalSend = process.send;

	beforeEach( () => {
		// In vitest fork pool, process.send is defined (IPC with the runner).
		// Clear it so the IPC-mode guard doesn't suppress the notice in non-IPC tests.
		process.send = undefined;
		// stderr is piped in the test runner, so isTTY is falsy; the notice only
		// renders on a visible terminal.
		setStderrIsTTY( true );
	} );

	afterEach( () => {
		process.send = originalSend;
		restoreStderrIsTTY();
	} );

	it( 'renders the notice and persists the flag on first run', async () => {
		const render = vi.fn();
		await maybeShowTosNotice( render );
		expect( render ).toHaveBeenCalledTimes( 1 );
		expect( shownAt() ).toEqual( expect.any( Number ) );
	} );

	it( 'does nothing when the notice was already shown', async () => {
		markShown();
		const render = vi.fn();
		await maybeShowTosNotice( render );
		expect( render ).not.toHaveBeenCalled();
		expect( updateConfig ).not.toHaveBeenCalled();
	} );

	it( 'does nothing in IPC mode (spawned by the desktop app)', async () => {
		process.send = vi.fn();
		const render = vi.fn();
		await maybeShowTosNotice( render );
		expect( render ).not.toHaveBeenCalled();
		expect( updateConfig ).not.toHaveBeenCalled();
	} );

	it( 'does nothing when stderr is not a TTY', async () => {
		setStderrIsTTY( undefined );
		const render = vi.fn();
		await maybeShowTosNotice( render );
		expect( render ).not.toHaveBeenCalled();
		expect( updateConfig ).not.toHaveBeenCalled();
	} );
} );
