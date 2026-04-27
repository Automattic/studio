/**
 * @vitest-environment node
 */
import { app } from 'electron';
import fs from 'fs';
import { vi } from 'vitest';
import type { PathLike } from 'fs';

// The overload of readdirSync that returns string[] (without withFileTypes option)
type ReaddirSyncStrings = (
	path: PathLike,
	options?:
		| BufferEncoding
		| null
		| {
				encoding?: BufferEncoding | null;
				withFileTypes?: false | undefined;
				recursive?: boolean | undefined;
		  }
) => string[];
type ReaddirSyncMock = ReturnType< typeof vi.fn< ReaddirSyncStrings > >;

vi.mock( 'fs', () => {
	const constants = { X_OK: 1 };
	return {
		default: {
			existsSync: vi.fn(),
			readdirSync: vi.fn(),
			statSync: vi.fn(),
			accessSync: vi.fn(),
			constants,
		},
		existsSync: vi.fn(),
		readdirSync: vi.fn(),
		statSync: vi.fn(),
		accessSync: vi.fn(),
		constants,
	};
} );

vi.mock( 'electron', () => ( {
	app: {
		getPath: vi.fn(),
	},
} ) );

const readdirSyncMock = fs.readdirSync as unknown as ReaddirSyncMock;

describe( 'isInstalled', () => {
	let isInstalled: ( key: keyof InstalledApps ) => boolean;
	let mockPaths: string[];

	beforeEach( () => {
		vi.resetAllMocks();
		mockPaths = [];

		const isMocked = ( testPath: unknown ): boolean => {
			const normalizedTestPath = String( testPath ).replace( /\\/g, '/' );
			const normalizedMockPaths = mockPaths.map( ( p ) => p.replace( /\\/g, '/' ) );
			return normalizedMockPaths.includes( normalizedTestPath );
		};

		vi.mocked( fs.existsSync ).mockImplementation( isMocked );

		vi.mocked( fs.statSync ).mockImplementation( ( ( testPath: unknown ) => {
			if ( ! isMocked( testPath ) ) {
				throw Object.assign( new Error( 'ENOENT' ), { code: 'ENOENT' } );
			}
			return { isFile: () => true } as unknown as fs.Stats;
		} ) as typeof fs.statSync );

		vi.mocked( fs.accessSync ).mockImplementation( ( testPath: unknown ) => {
			if ( ! isMocked( testPath ) ) {
				throw Object.assign( new Error( 'EACCES' ), { code: 'EACCES' } );
			}
		} );

		vi.mocked( app.getPath ).mockImplementation( ( name: string ) => {
			switch ( name ) {
				case 'home':
					return '/mock/home/path';
				case 'appData':
					return process.platform === 'win32'
						? 'C:\\Users\\TestUser\\AppData\\Roaming'
						: '/mock/home/path/.config';
				default:
					return '';
			}
		} );
	} );

	describe( 'on macOS (darwin)', () => {
		beforeEach( async () => {
			Object.defineProperty( process, 'platform', { value: 'darwin' } );
			// Re-import the module to ensure platform-specific paths are set up
			vi.resetModules();
			const module = await import( '../is-installed' );
			isInstalled = module.isInstalled;
		} );

		it( 'detects Visual Studio Code installed in system Applications', () => {
			mockPaths = [ '/Applications/Visual Studio Code.app' ];
			expect( isInstalled( 'vscode' ) ).toBe( true );
		} );

		it( 'detects Visual Studio Code installed in user Applications', () => {
			mockPaths = [ '/mock/home/path/Applications/Visual Studio Code.app' ];
			expect( isInstalled( 'vscode' ) ).toBe( true );
		} );

		it( 'returns false when Visual Studio Code is not installed', () => {
			mockPaths = [];
			expect( isInstalled( 'vscode' ) ).toBe( false );
		} );

		it( 'detects PhpStorm installed', () => {
			mockPaths = [ '/Applications/PhpStorm.app' ];
			expect( isInstalled( 'phpstorm' ) ).toBe( true );
		} );
	} );

	describe( 'on Windows (win32)', () => {
		beforeEach( async () => {
			Object.defineProperty( process, 'platform', { value: 'win32' } );
			process.env.ProgramFiles = 'D:\\Program Files';
			process.env.LOCALAPPDATA = 'C:\\Users\\TestUser\\AppData\\Local';
			// Re-import the module after setting the environment variable
			vi.resetModules();
			const module = await import( '../is-installed' );
			isInstalled = module.isInstalled;
		} );

		it( 'detects Visual Studio Code installed in Program Files', () => {
			mockPaths = [ 'D:\\Program Files\\Microsoft VS Code' ];
			expect( isInstalled( 'vscode' ) ).toBe( true );
		} );

		it( 'detects Visual Studio Code installed in Local Programs', () => {
			mockPaths = [ 'C:\\Users\\TestUser\\AppData\\Local\\Programs\\Microsoft VS Code' ];
			expect( isInstalled( 'vscode' ) ).toBe( true );
		} );

		it( 'detects PhpStorm with version-specific folder', () => {
			mockPaths = [ 'D:\\Program Files\\JetBrains', 'D:\\Program Files\\JetBrains\\PhpStorm' ];
			readdirSyncMock.mockReturnValue( [ 'PhpStorm 2023.1', 'WebStorm 2023.1' ] );

			expect( isInstalled( 'phpstorm' ) ).toBe( true );
		} );

		it( 'detects PhpStorm in Local Programs', () => {
			mockPaths = [ 'C:\\Users\\TestUser\\AppData\\Local\\Programs\\PhpStorm' ];
			expect( isInstalled( 'phpstorm' ) ).toBe( true );
		} );

		it( 'falls back to default Program Files path when environment variable is not set', async () => {
			delete process.env.ProgramFiles;
			// Re-import the module after setting the environment variable
			vi.resetModules();
			const module = await import( '../is-installed' );
			isInstalled = module.isInstalled;

			mockPaths = [ 'C:\\Program Files\\Microsoft VS Code' ];
			expect( isInstalled( 'vscode' ) ).toBe( true );
		} );

		it( 'falls back to electron appData path when LOCALAPPDATA is not set', async () => {
			delete process.env.LOCALAPPDATA;
			// Re-import the module after setting the environment variable
			vi.resetModules();
			const module = await import( '../is-installed' );
			isInstalled = module.isInstalled;

			mockPaths = [ 'C:\\Users\\TestUser\\AppData\\Roaming\\Local\\Programs\\Microsoft VS Code' ];
			expect( isInstalled( 'vscode' ) ).toBe( true );
		} );
	} );

	describe( 'on Linux', () => {
		const originalPath = process.env.PATH;

		beforeEach( async () => {
			Object.defineProperty( process, 'platform', { value: 'linux' } );
			process.env.PATH = '/usr/bin:/mock/home/path/.local/bin';
			vi.resetModules();
			const module = await import( '../is-installed' );
			isInstalled = module.isInstalled;
		} );

		afterEach( () => {
			process.env.PATH = originalPath;
		} );

		it( 'detects Zed installed in ~/.local/bin', () => {
			mockPaths = [ '/mock/home/path/.local/bin/zed' ];
			expect( isInstalled( 'zed' ) ).toBe( true );
		} );

		it( 'detects VS Code installed in /usr/bin', () => {
			mockPaths = [ '/usr/bin/code' ];
			expect( isInstalled( 'vscode' ) ).toBe( true );
		} );

		it( 'returns false when an editor binary is not on $PATH', () => {
			mockPaths = [];
			expect( isInstalled( 'zed' ) ).toBe( false );
		} );

		it( 'detects Warp via the hardcoded /usr/bin path (non-editor)', () => {
			mockPaths = [ '/usr/bin/warp' ];
			expect( isInstalled( 'warp' ) ).toBe( true );
		} );

		it( 'ignores a same-named directory on $PATH (not a regular file)', () => {
			mockPaths = [ '/usr/bin/code' ];
			vi.mocked( fs.statSync ).mockImplementation( ( ( testPath: unknown ) => {
				if ( String( testPath ) !== '/usr/bin/code' ) {
					throw Object.assign( new Error( 'ENOENT' ), { code: 'ENOENT' } );
				}
				return { isFile: () => false } as unknown as fs.Stats;
			} ) as typeof fs.statSync );
			expect( isInstalled( 'vscode' ) ).toBe( false );
		} );

		it( 'ignores a non-executable file on $PATH', () => {
			mockPaths = [ '/usr/bin/code' ];
			vi.mocked( fs.accessSync ).mockImplementation( () => {
				throw Object.assign( new Error( 'EACCES' ), { code: 'EACCES' } );
			} );
			expect( isInstalled( 'vscode' ) ).toBe( false );
		} );
	} );
} );
