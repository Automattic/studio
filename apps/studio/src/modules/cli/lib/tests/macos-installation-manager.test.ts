/**
 * @vitest-environment node
 */
import { vi } from 'vitest';
import {
	MacOSCliInstallationManager,
	autoInstallMacOSCliIfNeeded,
} from 'src/modules/cli/lib/macos-installation-manager';

const {
	mockLstat,
	mockMkdir,
	mockReadFile,
	mockReadlink,
	mockSymlink,
	mockUnlink,
	mockWriteFile,
	mockHomedir,
	mockGetResourcesPath,
	mockDialog,
	mockGetMainWindow,
	mockCaptureException,
	mockLoadUserData,
	mockUpdateAppdata,
} = vi.hoisted( () => ( {
	mockLstat: vi.fn(),
	mockMkdir: vi.fn(),
	mockReadFile: vi.fn(),
	mockReadlink: vi.fn(),
	mockSymlink: vi.fn(),
	mockUnlink: vi.fn(),
	mockWriteFile: vi.fn(),
	mockHomedir: vi.fn().mockReturnValue( '/Users/testuser' ),
	mockGetResourcesPath: vi.fn().mockReturnValue( '/Applications/Studio.app/Contents/Resources' ),
	mockDialog: { showMessageBox: vi.fn().mockResolvedValue( { response: 0 } ) },
	mockGetMainWindow: vi.fn().mockResolvedValue( {} ),
	mockCaptureException: vi.fn(),
	mockLoadUserData: vi.fn().mockResolvedValue( { version: 1, siteMetadata: {} } ),
	mockUpdateAppdata: vi.fn().mockResolvedValue( undefined ),
} ) );

vi.mock( 'node:fs/promises', () => ( {
	lstat: mockLstat,
	mkdir: mockMkdir,
	readFile: mockReadFile,
	readlink: mockReadlink,
	symlink: mockSymlink,
	unlink: mockUnlink,
	writeFile: mockWriteFile,
} ) );

vi.mock( 'node:os', () => ( {
	default: { homedir: mockHomedir },
	homedir: mockHomedir,
} ) );

vi.mock( 'electron', () => ( {
	dialog: mockDialog,
} ) );

vi.mock( 'src/storage/paths', () => ( {
	getResourcesPath: mockGetResourcesPath,
} ) );

vi.mock( 'src/main-window', () => ( {
	getMainWindow: mockGetMainWindow,
} ) );

vi.mock( '@sentry/electron/main', () => ( {
	captureException: mockCaptureException,
} ) );

vi.mock( '@wordpress/i18n', () => ( {
	__: ( str: string ) => str,
	sprintf: ( str: string, ...args: string[] ) => {
		let result = str;
		args.forEach( ( arg, i ) => {
			result = result.replace( `%${ i + 1 }$s`, arg );
		} );
		return result;
	},
} ) );

vi.mock( 'src/modules/cli/lib/ipc-handlers', () => ( {
	StudioCliInstallationManager: class {},
} ) );

vi.mock( 'src/storage/user-data', () => ( {
	loadUserData: mockLoadUserData,
	updateAppdata: mockUpdateAppdata,
} ) );

vi.mock( '@studio/common/lib/is-errno-exception', () => ( {
	isErrnoException: ( error: unknown ): error is NodeJS.ErrnoException =>
		error instanceof Error && 'code' in error,
} ) );

const CLI_SYMLINK_PATH = '/Users/testuser/.local/bin/studio';
const CLI_PACKAGED_PATH = '/Applications/Studio.app/Contents/Resources/bin/studio-cli.sh';

function enoentError() {
	const error = new Error( 'ENOENT' ) as NodeJS.ErrnoException;
	error.code = 'ENOENT';
	return error;
}

// These tests use POSIX paths — skip on Windows where path separators differ.
const isWindows = process.platform === 'win32';

describe.skipIf( isWindows )( 'MacOSCliInstallationManager', () => {
	let manager: MacOSCliInstallationManager;
	const originalPlatform = process.platform;
	const originalEnv = { ...process.env };

	beforeEach( () => {
		vi.clearAllMocks();
		Object.defineProperty( process, 'platform', { value: 'darwin' } );
		process.env.NODE_ENV = 'production';
		process.env.SHELL = '/bin/zsh';
		mockLoadUserData.mockResolvedValue( { version: 1, siteMetadata: {} } );
		mockUpdateAppdata.mockResolvedValue( undefined );
		manager = new MacOSCliInstallationManager();
	} );

	afterEach( () => {
		Object.defineProperty( process, 'platform', { value: originalPlatform } );
		process.env = { ...originalEnv };
	} );

	describe( 'constructor', () => {
		it( 'throws on non-darwin platforms', () => {
			Object.defineProperty( process, 'platform', { value: 'win32' } );
			expect( () => new MacOSCliInstallationManager() ).toThrow(
				'Use the appropriate installation manager for the current platform'
			);
		} );
	} );

	describe( 'isCliInstalled', () => {
		beforeEach( () => {
			// Default: profile contains the export line
			mockReadFile.mockResolvedValue( 'export PATH="$HOME/.local/bin:$PATH"\n' );
		} );

		it( 'returns true when symlink points to the packaged CLI', async () => {
			mockReadlink.mockResolvedValue( CLI_PACKAGED_PATH );
			expect( await manager.isCliInstalled() ).toBe( true );
		} );

		it( 'returns false when symlink does not exist', async () => {
			mockReadlink.mockRejectedValue( enoentError() );
			expect( await manager.isCliInstalled() ).toBe( false );
		} );

		it( 'returns false when symlink points to a different path', async () => {
			mockReadlink.mockResolvedValue( '/some/other/path' );
			expect( await manager.isCliInstalled() ).toBe( false );
		} );

		it( 'returns true in dev mode when symlink points to production CLI', async () => {
			process.env.NODE_ENV = 'development';
			mockReadlink.mockResolvedValue(
				'/Applications/Studio.app/Contents/Resources/bin/studio-cli.sh'
			);
			expect( await manager.isCliInstalled() ).toBe( true );
		} );

		it( 'returns false when symlink is valid but export line is not in profile', async () => {
			mockReadFile.mockResolvedValue( '# empty profile\n' );
			mockReadlink.mockResolvedValue( CLI_PACKAGED_PATH );
			expect( await manager.isCliInstalled() ).toBe( false );
		} );

		it( 'returns false when profile does not exist', async () => {
			mockReadFile.mockRejectedValue( enoentError() );
			mockReadlink.mockResolvedValue( CLI_PACKAGED_PATH );
			expect( await manager.isCliInstalled() ).toBe( false );
		} );
	} );

	describe( 'installCliWithConfirmation', () => {
		it( 'creates symlink and shows success dialog', async () => {
			mockLstat.mockRejectedValue( enoentError() );
			mockReadlink.mockRejectedValue( enoentError() );
			mockUnlink.mockRejectedValue( enoentError() );
			mockMkdir.mockResolvedValue( undefined );
			mockSymlink.mockResolvedValue( undefined );
			mockReadFile.mockRejectedValue( enoentError() );
			mockWriteFile.mockResolvedValue( undefined );

			await manager.installCliWithConfirmation();

			expect( mockSymlink ).toHaveBeenCalledWith( CLI_PACKAGED_PATH, CLI_SYMLINK_PATH );
			expect( mockDialog.showMessageBox ).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining( { type: 'info', title: 'CLI Installed' } )
			);
		} );

		it( 'shows error dialog when path is occupied by non-symlink', async () => {
			mockLstat.mockResolvedValue( { isSymbolicLink: () => false } );

			await manager.installCliWithConfirmation();

			expect( mockDialog.showMessageBox ).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining( { type: 'error' } )
			);
		} );
	} );

	describe( 'uninstallCliWithConfirmation', () => {
		it( 'removes symlink and shows success dialog', async () => {
			mockLstat.mockResolvedValue( { isSymbolicLink: () => true } );
			mockUnlink.mockResolvedValue( undefined );

			await manager.uninstallCliWithConfirmation();

			expect( mockUnlink ).toHaveBeenCalledWith( CLI_SYMLINK_PATH );
			expect( mockDialog.showMessageBox ).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining( { type: 'info', title: 'CLI uninstalled' } )
			);
		} );
	} );

	describe( 'autoInstallIfNeeded', () => {
		it( 'installs CLI on first launch when not already installed', async () => {
			// isCliInstalled returns false
			mockReadlink.mockRejectedValue( enoentError() );
			// installCli - lstat shows no file
			mockLstat.mockRejectedValue( enoentError() );
			// unlink during install
			mockUnlink.mockRejectedValue( enoentError() );
			mockMkdir.mockResolvedValue( undefined );
			mockSymlink.mockResolvedValue( undefined );
			// ensurePathInProfile
			mockReadFile.mockRejectedValue( enoentError() );
			mockWriteFile.mockResolvedValue( undefined );

			await manager.autoInstallIfNeeded();

			expect( mockMkdir ).toHaveBeenCalledWith( '/Users/testuser/.local/bin', {
				recursive: true,
			} );
			expect( mockSymlink ).toHaveBeenCalledWith( CLI_PACKAGED_PATH, CLI_SYMLINK_PATH );
			expect( mockUpdateAppdata ).toHaveBeenCalledWith( { cliAutoInstalled: true } );
		} );

		it( 'skips installation when CLI is already installed', async () => {
			// isLocalBinInProfile returns true
			mockReadFile.mockResolvedValue( 'export PATH="$HOME/.local/bin:$PATH"\n' );
			// isCliInstalled returns true
			mockReadlink.mockResolvedValue( CLI_PACKAGED_PATH );

			await manager.autoInstallIfNeeded();

			expect( mockSymlink ).not.toHaveBeenCalled();
		} );

		it( 'does not reinstall when user has explicitly disabled CLI', async () => {
			// CLI was previously auto-installed but user disabled it
			mockLoadUserData.mockResolvedValue( {
				version: 1,
				siteMetadata: {},
				cliAutoInstalled: true,
			} );
			// isCliInstalled returns false (user disabled it)
			mockReadlink.mockRejectedValue( enoentError() );

			await manager.autoInstallIfNeeded();

			expect( mockSymlink ).not.toHaveBeenCalled();
		} );
	} );

	describe( 'ensurePathInProfile (via installCli)', () => {
		beforeEach( () => {
			// Set up for a successful install to trigger ensurePathInProfile
			mockLstat.mockRejectedValue( enoentError() );
			mockReadlink.mockRejectedValue( enoentError() );
			mockUnlink.mockRejectedValue( enoentError() );
			mockMkdir.mockResolvedValue( undefined );
			mockSymlink.mockResolvedValue( undefined );
			mockWriteFile.mockResolvedValue( undefined );
		} );

		it( 'appends export to existing .zshrc', async () => {
			mockReadFile.mockResolvedValue( '# My zshrc\n' );

			await manager.autoInstallIfNeeded();

			expect( mockWriteFile ).toHaveBeenCalledWith(
				'/Users/testuser/.zshrc',
				'# My zshrc\nexport PATH="$HOME/.local/bin:$PATH"\n',
				'utf-8'
			);
		} );

		it( 'creates .zshrc with export when profile does not exist', async () => {
			mockReadFile.mockRejectedValue( enoentError() );

			await manager.autoInstallIfNeeded();

			expect( mockWriteFile ).toHaveBeenCalledWith(
				'/Users/testuser/.zshrc',
				'export PATH="$HOME/.local/bin:$PATH"\n',
				'utf-8'
			);
		} );

		it( 'does not duplicate export if already present in profile', async () => {
			mockReadFile.mockResolvedValue( '# My zshrc\nexport PATH="$HOME/.local/bin:$PATH"\n' );

			await manager.autoInstallIfNeeded();

			expect( mockWriteFile ).not.toHaveBeenCalled();
		} );

		it( 'uses .bash_profile when SHELL is /bin/bash', async () => {
			process.env.SHELL = '/bin/bash';
			mockReadFile.mockResolvedValue( '# Bash profile\n' );

			await manager.autoInstallIfNeeded();

			expect( mockWriteFile ).toHaveBeenCalledWith(
				'/Users/testuser/.bash_profile',
				expect.stringContaining( 'export PATH="$HOME/.local/bin:$PATH"' ),
				'utf-8'
			);
		} );

		it( 'defaults to .zshrc when SHELL is not recognized', async () => {
			process.env.SHELL = '/bin/fish';
			mockReadFile.mockRejectedValue( enoentError() );

			await manager.autoInstallIfNeeded();

			expect( mockWriteFile ).toHaveBeenCalledWith(
				'/Users/testuser/.zshrc',
				'export PATH="$HOME/.local/bin:$PATH"\n',
				'utf-8'
			);
		} );

		it( 'adds newline before export if file does not end with newline', async () => {
			mockReadFile.mockResolvedValue( '# My zshrc' );

			await manager.autoInstallIfNeeded();

			expect( mockWriteFile ).toHaveBeenCalledWith(
				'/Users/testuser/.zshrc',
				'# My zshrc\nexport PATH="$HOME/.local/bin:$PATH"\n',
				'utf-8'
			);
		} );
	} );
} );

describe( 'autoInstallMacOSCliIfNeeded', () => {
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

	it( 'does nothing on non-darwin platforms', async () => {
		Object.defineProperty( process, 'platform', { value: 'win32' } );
		await autoInstallMacOSCliIfNeeded();
		expect( mockReadlink ).not.toHaveBeenCalled();
	} );

	it( 'does nothing in development mode', async () => {
		Object.defineProperty( process, 'platform', { value: 'darwin' } );
		process.env.NODE_ENV = 'development';
		await autoInstallMacOSCliIfNeeded();
		expect( mockReadlink ).not.toHaveBeenCalled();
	} );

	it( 'catches and logs errors without throwing', async () => {
		Object.defineProperty( process, 'platform', { value: 'darwin' } );
		// Force an error by making lstat throw unexpectedly
		mockLstat.mockRejectedValue( new Error( 'Unexpected error' ) );
		mockReadlink.mockRejectedValue( enoentError() );

		await expect( autoInstallMacOSCliIfNeeded() ).resolves.not.toThrow();
		expect( mockCaptureException ).toHaveBeenCalled();
	} );
} );
