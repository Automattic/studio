/**
 * @vitest-environment node
 */
import { app, autoUpdater, clipboard, dialog, shell, type MessageBoxOptions } from 'electron';
import * as Sentry from '@sentry/electron/main';
import { vi } from 'vitest';
import { sendIpcEventToRenderer, type AppUpdateStatus } from 'src/ipc-utils';
import { setAgenticUiEnabled } from 'src/lib/studio-ui-mode';
import { manualCheckForUpdates, setupUpdates, switchToNightlyAndUpdate } from 'src/updates';

function getLastDialogOptions(): MessageBoxOptions {
	const lastCall = vi.mocked( dialog.showMessageBox ).mock.lastCall as unknown as [
		unknown,
		MessageBoxOptions,
	];
	return lastCall[ 1 ];
}

vi.mock( 'src/main-window', () => ( {
	getMainWindow: vi.fn().mockResolvedValue( {
		isDestroyed: () => false,
		webContents: { isDestroyed: () => false, send: vi.fn() },
	} ),
	getExistingMainWindow: vi.fn().mockReturnValue( {
		isDestroyed: () => false,
		webContents: { isDestroyed: () => false, send: vi.fn() },
	} ),
} ) );

vi.mock( 'src/ipc-utils', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('src/ipc-utils') >() ),
	sendIpcEventToRenderer: vi.fn().mockResolvedValue( undefined ),
} ) );

function getEmittedStatuses(): AppUpdateStatus[] {
	return vi
		.mocked( sendIpcEventToRenderer )
		.mock.calls.filter( ( [ channel ] ) => channel === 'app-update-status' )
		.map( ( [ , status ] ) => status as AppUpdateStatus );
}

function getLastEmittedStatus(): AppUpdateStatus | undefined {
	return getEmittedStatuses().at( -1 );
}

const originalFetch = global.fetch;
const originalPlatform = process.platform;
const originalArch = process.arch;

beforeEach( () => {
	Object.defineProperty( process, 'platform', { value: 'linux', configurable: true } );
	Object.defineProperty( process, 'arch', { value: 'arm64', configurable: true } );
	vi.mocked( app.getVersion ).mockReturnValue( '1.8.2' );
	// shell.openExternal isn't part of the global electron mock in vitest.setup.ts.
	( shell as unknown as { openExternal: ReturnType< typeof vi.fn > } ).openExternal = vi
		.fn()
		.mockResolvedValue( undefined );
} );

afterEach( () => {
	global.fetch = originalFetch;
	Object.defineProperty( process, 'platform', { value: originalPlatform, configurable: true } );
	Object.defineProperty( process, 'arch', { value: originalArch, configurable: true } );
} );

describe( 'Linux updater', () => {
	it( 'shows the download dialog with the install command and opens the browser on Download', async () => {
		global.fetch = vi.fn().mockResolvedValue( {
			status: 200,
			ok: true,
			json: async () => ( {
				version: '1.9.0',
				downloadUrl: 'https://appscdn.example.com/path/studio_1.9.0_arm64.deb',
			} ),
		} as Response );
		vi.mocked( dialog.showMessageBox ).mockResolvedValue( {
			response: 0,
			checkboxChecked: false,
		} );

		await manualCheckForUpdates();

		await vi.waitFor( () => {
			expect( dialog.showMessageBox ).toHaveBeenCalled();
		} );

		const args = getLastDialogOptions();
		expect( args.message ).toContain( '1.9.0' );
		expect( args.detail ).toContain( 'sudo apt install ~/Downloads/studio_1.9.0_arm64.deb' );

		expect( shell.openExternal ).toHaveBeenCalledWith(
			'https://appscdn.example.com/path/studio_1.9.0_arm64.deb'
		);
	} );

	it( 'copies the install command to the clipboard when the user clicks the primary button', async () => {
		global.fetch = vi.fn().mockResolvedValue( {
			status: 200,
			ok: true,
			json: async () => ( {
				version: '1.9.0',
				downloadUrl: 'https://appscdn.example.com/path/studio_1.9.0_arm64.deb',
			} ),
		} as Response );
		vi.mocked( dialog.showMessageBox ).mockResolvedValue( {
			response: 0,
			checkboxChecked: false,
		} );

		await manualCheckForUpdates();

		await vi.waitFor( () => {
			expect( shell.openExternal ).toHaveBeenCalled();
		} );

		expect( clipboard.writeText ).toHaveBeenCalledWith(
			'sudo apt install ~/Downloads/studio_1.9.0_arm64.deb'
		);
	} );

	it( 'does not copy to the clipboard or open the browser when the user dismisses the dialog', async () => {
		global.fetch = vi.fn().mockResolvedValue( {
			status: 200,
			ok: true,
			json: async () => ( {
				version: '1.9.0',
				downloadUrl: 'https://appscdn.example.com/path/studio_1.9.0_arm64.deb',
			} ),
		} as Response );
		vi.mocked( dialog.showMessageBox ).mockResolvedValue( {
			response: 1,
			checkboxChecked: false,
		} );

		await manualCheckForUpdates();

		await vi.waitFor( () => {
			expect( dialog.showMessageBox ).toHaveBeenCalled();
		} );

		expect( clipboard.writeText ).not.toHaveBeenCalled();
		expect( shell.openExternal ).not.toHaveBeenCalled();
	} );

	it( 'shows "No updates available" on a manual check when the server returns 204', async () => {
		global.fetch = vi.fn().mockResolvedValue( {
			status: 204,
			ok: true,
		} as Response );
		vi.mocked( dialog.showMessageBox ).mockResolvedValue( {
			response: 0,
			checkboxChecked: false,
		} );

		await manualCheckForUpdates();

		await vi.waitFor( () => {
			expect( dialog.showMessageBox ).toHaveBeenCalled();
		} );

		const args = getLastDialogOptions();
		expect( args.message ).toBe( 'No updates available' );
		expect( shell.openExternal ).not.toHaveBeenCalled();
	} );

	it( 'reports to Sentry and shows no dialog when the server returns an error status', async () => {
		global.fetch = vi.fn().mockResolvedValue( {
			status: 500,
			ok: false,
		} as Response );

		await manualCheckForUpdates();

		await vi.waitFor( () => {
			expect( Sentry.captureException ).toHaveBeenCalled();
		} );

		expect( dialog.showMessageBox ).not.toHaveBeenCalled();
		expect( shell.openExternal ).not.toHaveBeenCalled();
	} );
} );

describe( 'update ready to install', () => {
	async function emitUpdateDownloaded() {
		Object.defineProperty( process, 'platform', { value: 'darwin', configurable: true } );
		setupUpdates();
		const calls = vi.mocked( autoUpdater.on ).mock.calls as unknown as [
			string,
			( ...args: unknown[] ) => Promise< void >,
		][];
		const handler = calls.find( ( [ event ] ) => event === 'update-downloaded' )?.[ 1 ];
		await handler?.( {}, 'notes', '1.9.0' );
	}

	afterEach( () => {
		setAgenticUiEnabled( false );
	} );

	it( 'shows the restart dialog in the classic UI', async () => {
		await emitUpdateDownloaded();

		expect( getLastDialogOptions().message ).toBe( 'Update ready to install' );
	} );

	it( 'leaves the restart prompt to the sidebar card in the agentic UI', async () => {
		setAgenticUiEnabled( true );

		await emitUpdateDownloaded();

		expect( dialog.showMessageBox ).not.toHaveBeenCalled();
	} );
} );

describe( 'update status emissions', () => {
	function setupDarwinUpdates() {
		Object.defineProperty( process, 'platform', { value: 'darwin', configurable: true } );
		setupUpdates();
	}

	// The flag that tells the event handlers a user asked for this check.
	function showManualCheck() {
		void manualCheckForUpdates();
	}

	function getHandler( event: string ) {
		const calls = vi.mocked( autoUpdater.on ).mock.calls as unknown as [
			string,
			( ...args: unknown[] ) => Promise< void > | void,
		][];
		return calls.find( ( [ name ] ) => name === event )?.[ 1 ];
	}

	beforeEach( () => {
		// setupUpdates registers listeners on the shared autoUpdater mock; without clearing,
		// getHandler would find the previous test's handler and its stale module state.
		vi.mocked( autoUpdater.on ).mockClear();
		vi.mocked( sendIpcEventToRenderer ).mockClear();
		vi.mocked( dialog.showMessageBox ).mockClear();
	} );

	afterEach( () => {
		setAgenticUiEnabled( false );
	} );

	it( 'emits a checking state with the current version', async () => {
		setupDarwinUpdates();

		await getHandler( 'checking-for-update' )?.();

		expect( getLastEmittedStatus() ).toEqual( { state: 'checking', currentVersion: '1.8.2' } );
	} );

	it( 'emits downloading, then re-emits with the version the feed reports', async () => {
		global.fetch = vi.fn().mockResolvedValue( {
			status: 200,
			ok: true,
			json: async () => ( { version: '1.9.0' } ),
		} as Response );
		setupDarwinUpdates();

		await getHandler( 'update-available' )?.();

		const statuses = getEmittedStatuses();
		expect( statuses ).toContainEqual( {
			state: 'downloading',
			currentVersion: '1.8.2',
			newVersion: null,
		} );
		expect( getLastEmittedStatus() ).toEqual( {
			state: 'downloading',
			currentVersion: '1.8.2',
			newVersion: '1.9.0',
		} );
	} );

	it( 'reads the version out of the Squirrel feed URL on macOS and Windows', async () => {
		global.fetch = vi.fn().mockResolvedValue( {
			status: 200,
			ok: true,
			json: async () => ( {
				url: 'https://appscdn.wordpress.com/downloads/wordpress-com-studio/mac-silicon/v1.9.0/21476/update/studio-arm64-v1.9.0.zip',
			} ),
		} as Response );
		setupDarwinUpdates();

		await getHandler( 'update-available' )?.();

		expect( getLastEmittedStatus() ).toEqual( {
			state: 'downloading',
			currentVersion: '1.8.2',
			newVersion: '1.9.0',
		} );
	} );

	it( 'leaves the new version unnamed when the feed lookup fails', async () => {
		global.fetch = vi.fn().mockRejectedValue( new Error( 'offline' ) );
		setupDarwinUpdates();

		await getHandler( 'update-available' )?.();

		expect( getLastEmittedStatus() ).toEqual( {
			state: 'downloading',
			currentVersion: '1.8.2',
			newVersion: null,
		} );
	} );

	it( 'emits a ready state naming both versions once the download completes', async () => {
		setupDarwinUpdates();

		await getHandler( 'update-downloaded' )?.( {}, 'notes', '1.9.0' );

		expect( getLastEmittedStatus() ).toEqual( {
			state: 'ready',
			currentVersion: '1.8.2',
			newVersion: '1.9.0',
		} );
	} );

	it( 'emits an error state when the updater fails', async () => {
		setupDarwinUpdates();

		await getHandler( 'error' )?.( new Error( 'boom' ) );

		expect( getLastEmittedStatus() ).toEqual( {
			state: 'error',
			currentVersion: '1.8.2',
			reason: 'generic',
		} );
	} );

	it( 'reports a read-only volume error to the sidebar instead of a dialog in the agentic UI', async () => {
		// Not part of the shared electron mock; only this path calls it.
		( app as unknown as { isInApplicationsFolder: () => boolean } ).isInApplicationsFolder = () =>
			true;
		setAgenticUiEnabled( true );
		setupDarwinUpdates();

		const err = Object.assign( new Error( 'read-only' ), { code: 8 } );
		await getHandler( 'error' )?.( err );

		await vi.waitFor( () => {
			expect( getLastEmittedStatus() ).toMatchObject( {
				state: 'error',
				reason: 'read-only-volume',
			} );
		} );
		expect( dialog.showMessageBox ).not.toHaveBeenCalled();
	} );

	it( 'names both versions in the manual-check dialog', async () => {
		global.fetch = vi.fn().mockResolvedValue( {
			status: 200,
			ok: true,
			json: async () => ( { version: '1.9.0' } ),
		} as Response );
		setupDarwinUpdates();
		showManualCheck();

		await getHandler( 'update-available' )?.();

		expect( getLastDialogOptions().message ).toBe( 'Updating Studio from 1.8.2 to 1.9.0' );
	} );

	it( 'queries the nightly feed for the version after switching channels', async () => {
		const fetchMock = vi.fn().mockResolvedValue( {
			status: 200,
			ok: true,
			json: async () => ( { version: '1.9.0-dev.1' } ),
		} as Response );
		global.fetch = fetchMock;
		setupDarwinUpdates();
		switchToNightlyAndUpdate();

		await getHandler( 'update-available' )?.();

		expect( String( fetchMock.mock.calls.at( -1 )?.[ 0 ] ) ).toContain( 'channel=nightly' );
	} );

	it( 'still reports status when a manual check runs mid-download in the agentic UI', async () => {
		setAgenticUiEnabled( true );
		setupDarwinUpdates();
		await getHandler( 'update-available' )?.();
		vi.mocked( sendIpcEventToRenderer ).mockClear();

		await manualCheckForUpdates();

		expect( getLastEmittedStatus() ).toMatchObject( { state: 'downloading' } );
		expect( dialog.showMessageBox ).not.toHaveBeenCalled();
	} );

	it( 'still reports status when a manual check runs while ready to restart in the agentic UI', async () => {
		setAgenticUiEnabled( true );
		setupDarwinUpdates();
		await getHandler( 'update-downloaded' )?.( {}, 'notes', '1.9.0' );
		vi.mocked( sendIpcEventToRenderer ).mockClear();

		await manualCheckForUpdates();

		expect( getLastEmittedStatus() ).toMatchObject( { state: 'ready', newVersion: '1.9.0' } );
		expect( dialog.showMessageBox ).not.toHaveBeenCalled();
	} );

	it( 'flags manual re-emissions so a dismissed card comes back', async () => {
		setAgenticUiEnabled( true );
		setupDarwinUpdates();
		await getHandler( 'update-downloaded' )?.( {}, 'notes', '1.9.0' );
		vi.mocked( sendIpcEventToRenderer ).mockClear();

		await manualCheckForUpdates();

		expect( getLastEmittedStatus() ).toMatchObject( { state: 'ready', requested: true } );
	} );

	it( 'does not flag automatic emissions as requested', async () => {
		setAgenticUiEnabled( true );
		setupDarwinUpdates();

		await getHandler( 'update-downloaded' )?.( {}, 'notes', '1.9.0' );

		expect( getLastEmittedStatus()?.requested ).toBeUndefined();
	} );

	it( 'leaves the manual restart prompt to the sidebar card in the agentic UI', async () => {
		setAgenticUiEnabled( true );
		setupDarwinUpdates();
		await getHandler( 'update-downloaded' )?.( {}, 'notes', '1.9.0' );
		vi.mocked( dialog.showMessageBox ).mockClear();

		await manualCheckForUpdates();

		expect( dialog.showMessageBox ).not.toHaveBeenCalled();
	} );
} );
