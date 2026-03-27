/**
 * @vitest-environment node
 */
import { vi } from 'vitest';
import {
	MacOSCliInstallationManager,
	autoInstallMacOSCliIfNeeded,
} from 'src/modules/cli/lib/macos-installation-manager';

const {
	mockAccess,
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
	mockAccess: vi.fn(),
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
	access: mockAccess,
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
const LEGACY_SYMLINK_PATH = '/usr/local/bin/studio';

function enoentError() {
	const error = new Error( 'ENOENT' ) as NodeJS.ErrnoException;
	error.code = 'ENOENT';
	return error;
}

function eaccesError() {
	const error = new Error( 'EACCES' ) as NodeJS.ErrnoException;
	error.code = 'EACCES';
	return error;
}

describe( 'MacOSCliInstallationManager', () => {
	let manager: MacOSCliInstallationManager;
	const originalPlatform = process.platform;
	const originalEnv = { ...process.env };

	beforeEach( () => {
		vi.clearAllMocks();
		Object.defineProperty( process, 'platform', { value: 'darwin' } );
		process.env.PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
		process.env.NODE_ENV = 'production';
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
	} );

	describe( 'installCliWithConfirmation', () => {
		it( 'creates symlink and shows success dialog', async () => {
			mockLstat.mockRejectedValue( enoentError() );
			mockReadlink.mockRejectedValue( enoentError() );
			mockUnlink.mockRejectedValue( enoentError() );
			mockMkdir.mockResolvedValue( undefined );
			mockSymlink.mockResolvedValue( undefined );
			mockAccess.mockRejectedValue( enoentError() );
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
			mockAccess.mockRejectedValue( enoentError() );
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
			// cleanupLegacySymlink - no legacy symlink
			mockLstat.mockRejectedValue( enoentError() );
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
			// cleanupLegacySymlink - no legacy symlink
			mockLstat.mockRejectedValue( enoentError() );
			// isCliInstalled returns false (user disabled it)
			mockReadlink.mockRejectedValue( enoentError() );

			await manager.autoInstallIfNeeded();

			expect( mockSymlink ).not.toHaveBeenCalled();
		} );

		it( 'cleans up legacy symlink before installing', async () => {
			// First lstat call is for legacy cleanup, second is for installCli
			mockLstat
				.mockResolvedValueOnce( { isSymbolicLink: () => true } ) // legacy exists
				.mockRejectedValueOnce( enoentError() ); // new path doesn't exist

			// readlink: first for legacy check, then for isCliInstalled (x2 in autoInstall + installCli)
			mockReadlink
				.mockResolvedValueOnce( '/Applications/Studio.app/Contents/Resources/bin/studio-cli.sh' ) // legacy target
				.mockRejectedValueOnce( enoentError() ) // isCliInstalled in autoInstall
				.mockRejectedValueOnce( enoentError() ); // isCliInstalled in installCli

			mockUnlink
				.mockResolvedValueOnce( undefined ) // legacy unlink
				.mockRejectedValueOnce( enoentError() ); // new path unlink (doesn't exist)

			mockMkdir.mockResolvedValue( undefined );
			mockSymlink.mockResolvedValue( undefined );
			mockAccess.mockRejectedValue( enoentError() );
			mockReadFile.mockRejectedValue( enoentError() );
			mockWriteFile.mockResolvedValue( undefined );

			await manager.autoInstallIfNeeded();

			// Legacy symlink should be removed
			expect( mockUnlink ).toHaveBeenCalledWith( LEGACY_SYMLINK_PATH );
			// New symlink should be created
			expect( mockSymlink ).toHaveBeenCalledWith( CLI_PACKAGED_PATH, CLI_SYMLINK_PATH );
		} );

		it( 'silently handles legacy cleanup permission errors', async () => {
			// Legacy symlink cleanup throws EACCES
			mockLstat.mockRejectedValueOnce( eaccesError() ).mockRejectedValueOnce( enoentError() );

			// isCliInstalled returns false then installCli checks again
			mockReadlink.mockRejectedValue( enoentError() );
			mockUnlink.mockRejectedValue( enoentError() );
			mockMkdir.mockResolvedValue( undefined );
			mockSymlink.mockResolvedValue( undefined );
			mockAccess.mockRejectedValue( enoentError() );
			mockReadFile.mockRejectedValue( enoentError() );
			mockWriteFile.mockResolvedValue( undefined );

			// Should not throw
			await expect( manager.autoInstallIfNeeded() ).resolves.not.toThrow();
			expect( mockSymlink ).toHaveBeenCalled();
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

		it( 'skips profile update if ~/.local/bin is already in PATH', async () => {
			process.env.PATH = '/Users/testuser/.local/bin:/usr/bin:/bin';

			await manager.autoInstallIfNeeded();

			expect( mockWriteFile ).not.toHaveBeenCalled();
		} );

		it( 'appends export to existing .zshrc', async () => {
			mockAccess.mockResolvedValueOnce( undefined ); // .zshrc exists
			mockReadFile.mockResolvedValueOnce( '# My zshrc\n' );

			await manager.autoInstallIfNeeded();

			expect( mockWriteFile ).toHaveBeenCalledWith(
				'/Users/testuser/.zshrc',
				'# My zshrc\nexport PATH="$HOME/.local/bin:$PATH"\n',
				'utf-8'
			);
		} );

		it( 'creates .zshrc with export when no profile exists', async () => {
			mockAccess.mockRejectedValue( enoentError() ); // No profile files exist
			mockReadFile.mockRejectedValueOnce( enoentError() ); // .zshrc doesn't exist yet

			await manager.autoInstallIfNeeded();

			expect( mockWriteFile ).toHaveBeenCalledWith(
				'/Users/testuser/.zshrc',
				'export PATH="$HOME/.local/bin:$PATH"\n',
				'utf-8'
			);
		} );

		it( 'does not duplicate export if already present in profile', async () => {
			mockAccess.mockResolvedValueOnce( undefined );
			mockReadFile.mockResolvedValueOnce( '# My zshrc\nexport PATH="$HOME/.local/bin:$PATH"\n' );

			await manager.autoInstallIfNeeded();

			expect( mockWriteFile ).not.toHaveBeenCalled();
		} );

		it( 'uses .bash_profile if .zshrc and .zprofile do not exist', async () => {
			mockAccess
				.mockRejectedValueOnce( enoentError() ) // .zshrc
				.mockRejectedValueOnce( enoentError() ) // .zprofile
				.mockResolvedValueOnce( undefined ); // .bash_profile exists
			mockReadFile.mockResolvedValueOnce( '# Bash profile\n' );

			await manager.autoInstallIfNeeded();

			expect( mockWriteFile ).toHaveBeenCalledWith(
				'/Users/testuser/.bash_profile',
				expect.stringContaining( 'export PATH="$HOME/.local/bin:$PATH"' ),
				'utf-8'
			);
		} );

		it( 'adds newline before export if file does not end with newline', async () => {
			mockAccess.mockResolvedValueOnce( undefined );
			mockReadFile.mockResolvedValueOnce( '# My zshrc' ); // No trailing newline

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

	beforeEach( () => {
		vi.clearAllMocks();
		mockLoadUserData.mockResolvedValue( { version: 1, siteMetadata: {} } );
		mockUpdateAppdata.mockResolvedValue( undefined );
	} );

	afterEach( () => {
		Object.defineProperty( process, 'platform', { value: originalPlatform } );
	} );

	it( 'does nothing on non-darwin platforms', async () => {
		Object.defineProperty( process, 'platform', { value: 'win32' } );
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
