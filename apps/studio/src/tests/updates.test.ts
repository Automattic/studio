/**
 * @vitest-environment node
 */
import { app, autoUpdater, clipboard, dialog, shell, type MessageBoxOptions } from 'electron';
import * as Sentry from '@sentry/electron/main';
import { vi } from 'vitest';
import { setAgenticUiEnabled } from 'src/lib/studio-ui-mode';
import { manualCheckForUpdates, setupUpdates } from 'src/updates';

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
