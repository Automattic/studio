/**
 * @vitest-environment node
 */
import { vi } from 'vitest';
import {
	WindowsCliInstallationManager,
	autoInstallWindowsCliIfNeeded,
} from 'src/modules/cli/lib/windows-installation-manager';

const {
	mockMkdir,
	mockRm,
	mockWriteFile,
	mockExistsSync,
	mockDialog,
	mockGetMainWindow,
	mockApp,
	mockCaptureException,
	mockLoadUserData,
	mockUpdateAppdata,
	mockRegistryGet,
	mockRegistrySet,
} = vi.hoisted( () => ( {
	mockMkdir: vi.fn(),
	mockRm: vi.fn(),
	mockWriteFile: vi.fn(),
	mockExistsSync: vi.fn().mockReturnValue( true ),
	mockDialog: { showMessageBox: vi.fn().mockResolvedValue( { response: 0 } ) },
	mockGetMainWindow: vi.fn().mockResolvedValue( {} ),
	mockApp: {
		getPath: vi
			.fn()
			.mockReturnValue( 'C:\\Users\\testuser\\AppData\\Local\\studio\\app-1.0.0\\Studio.exe' ),
	},
	mockCaptureException: vi.fn(),
	mockLoadUserData: vi.fn().mockResolvedValue( { version: 1, siteMetadata: {} } ),
	mockUpdateAppdata: vi.fn().mockResolvedValue( undefined ),
	mockRegistryGet: vi.fn(),
	mockRegistrySet: vi.fn(),
} ) );

vi.mock( 'fs/promises', () => ( {
	mkdir: mockMkdir,
	rm: mockRm,
	writeFile: mockWriteFile,
} ) );

vi.mock( 'node:fs', () => ( {
	existsSync: mockExistsSync,
} ) );

vi.mock( 'electron', () => ( {
	app: mockApp,
	dialog: mockDialog,
} ) );

vi.mock( 'winreg', () => {
	function MockRegistry() {
		return {
			get: mockRegistryGet,
			set: mockRegistrySet,
		};
	}
	MockRegistry.HKCU = 'HKCU';
	MockRegistry.REG_EXPAND_SZ = 'REG_EXPAND_SZ';
	return { default: MockRegistry };
} );

vi.mock( 'src/main-window', () => ( {
	getMainWindow: mockGetMainWindow,
} ) );

vi.mock( '@sentry/electron/main', () => ( {
	captureException: mockCaptureException,
} ) );

vi.mock( '@wordpress/i18n', () => ( {
	__: ( str: string ) => str,
} ) );

vi.mock( 'src/modules/cli/lib/ipc-handlers', () => ( {
	StudioCliInstallationManager: class {},
} ) );

vi.mock( 'src/storage/user-data', () => ( {
	loadUserData: mockLoadUserData,
	updateAppdata: mockUpdateAppdata,
} ) );

// These tests use Windows paths — skip on non-Windows where path separators differ.
const isNonWindows = process.platform !== 'win32';

describe.skipIf( isNonWindows )( 'WindowsCliInstallationManager', () => {
	let manager: WindowsCliInstallationManager;
	const originalPlatform = process.platform;
	const originalEnv = { ...process.env };

	beforeEach( () => {
		vi.clearAllMocks();
		Object.defineProperty( process, 'platform', { value: 'win32' } );
		process.env.NODE_ENV = 'production';
		mockLoadUserData.mockResolvedValue( { version: 1, siteMetadata: {} } );
		mockUpdateAppdata.mockResolvedValue( undefined );
		mockMkdir.mockResolvedValue( undefined );
		mockWriteFile.mockResolvedValue( undefined );
		manager = new WindowsCliInstallationManager();
	} );

	afterEach( () => {
		Object.defineProperty( process, 'platform', { value: originalPlatform } );
		process.env = { ...originalEnv };
	} );

	describe( 'constructor', () => {
		it( 'throws on non-win32 platforms', () => {
			Object.defineProperty( process, 'platform', { value: 'darwin' } );
			expect( () => new WindowsCliInstallationManager() ).toThrow(
				'Use the appropriate installation manager for the current platform'
			);
		} );
	} );

	describe( 'autoInstallIfNeeded', () => {
		it( 'installs CLI on first launch when not already installed', async () => {
			// Registry PATH doesn't contain studio bin dir
			mockRegistryGet.mockImplementation(
				( _key: string, cb: ( err: Error | null, item?: { value: string } ) => void ) =>
					cb( null, { value: 'C:\\Windows\\system32' } )
			);
			mockRegistrySet.mockImplementation(
				( _key: string, _type: string, _value: string, cb: ( err: Error | null ) => void ) =>
					cb( null )
			);

			await manager.autoInstallIfNeeded();

			expect( mockWriteFile ).toHaveBeenCalled();
			expect( mockUpdateAppdata ).toHaveBeenCalledWith( { cliAutoInstalled: true } );
		} );

		it( 'skips install but updates proxy bat when flag is set and CLI is installed', async () => {
			mockLoadUserData.mockResolvedValue( {
				version: 1,
				siteMetadata: {},
				cliAutoInstalled: true,
			} );
			// Studio bin dir is in registry PATH
			mockRegistryGet.mockImplementation(
				( _key: string, cb: ( err: Error | null, item?: { value: string } ) => void ) =>
					cb( null, {
						value: 'C:\\Users\\testuser\\AppData\\Local\\studio\\bin;C:\\Windows\\system32',
					} )
			);

			await manager.autoInstallIfNeeded();

			// Should update proxy bat file but not call updateAppdata again
			expect( mockWriteFile ).toHaveBeenCalled();
			expect( mockUpdateAppdata ).not.toHaveBeenCalled();
		} );

		it( 'does not reinstall when user has explicitly disabled CLI', async () => {
			mockLoadUserData.mockResolvedValue( {
				version: 1,
				siteMetadata: {},
				cliAutoInstalled: true,
			} );
			// Studio bin dir is NOT in registry PATH (user uninstalled)
			mockRegistryGet.mockImplementation(
				( _key: string, cb: ( err: Error | null, item?: { value: string } ) => void ) =>
					cb( null, { value: 'C:\\Windows\\system32' } )
			);

			await manager.autoInstallIfNeeded();

			// Should not install or update
			expect( mockRegistrySet ).not.toHaveBeenCalled();
			expect( mockUpdateAppdata ).not.toHaveBeenCalled();
		} );
	} );
} );

describe( 'autoInstallWindowsCliIfNeeded', () => {
	const originalPlatform = process.platform;
	const originalEnv = { ...process.env };

	beforeEach( () => {
		vi.clearAllMocks();
		mockLoadUserData.mockResolvedValue( { version: 1, siteMetadata: {} } );
		mockUpdateAppdata.mockResolvedValue( undefined );
		process.env.NODE_ENV = 'production';
	} );

	afterEach( () => {
		Object.defineProperty( process, 'platform', { value: originalPlatform } );
		process.env = { ...originalEnv };
	} );

	it( 'does nothing on non-win32 platforms', async () => {
		Object.defineProperty( process, 'platform', { value: 'darwin' } );
		await autoInstallWindowsCliIfNeeded();
		expect( mockLoadUserData ).not.toHaveBeenCalled();
	} );

	it( 'does nothing in development mode', async () => {
		Object.defineProperty( process, 'platform', { value: 'win32' } );
		process.env.NODE_ENV = 'development';
		await autoInstallWindowsCliIfNeeded();
		expect( mockLoadUserData ).not.toHaveBeenCalled();
	} );

	it( 'catches and logs errors without throwing', async () => {
		Object.defineProperty( process, 'platform', { value: 'win32' } );
		mockLoadUserData.mockRejectedValue( new Error( 'Unexpected error' ) );

		await expect( autoInstallWindowsCliIfNeeded() ).resolves.not.toThrow();
		expect( mockCaptureException ).toHaveBeenCalled();
	} );
} );
