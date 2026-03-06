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

vi.mock( 'fs', () => {
	const existsSync = vi.fn< ( path: PathLike ) => boolean >();
	const readdirSync = vi.fn< ReaddirSyncStrings >();

	return {
		default: { existsSync, readdirSync },
		existsSync,
		readdirSync,
	};
} );

vi.mock( 'electron', () => ( {
	app: {
		getPath: vi.fn(),
	},
} ) );

function mockReaddirSync( files: string[] ) {
	(
		vi.mocked( fs.readdirSync ) as ReturnType< typeof vi.fn< ReaddirSyncStrings > >
	 ).mockImplementation( () => files );
}

describe( 'isInstalled', () => {
	let isInstalled: ( key: keyof InstalledApps ) => boolean;
	let mockPaths: string[];

	beforeEach( () => {
		vi.resetAllMocks();
		mockPaths = [];

		vi.mocked( fs.existsSync ).mockImplementation( ( testPath ) => {
			const pathStr = String( testPath );
			const normalizedTestPath = pathStr.replace( /\\/g, '/' );
			const normalizedMockPaths = mockPaths.map( ( p ) => p.replace( /\\/g, '/' ) );
			return normalizedMockPaths.includes( normalizedTestPath );
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
			mockReaddirSync( [ 'PhpStorm 2023.1', 'WebStorm 2023.1' ] );
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
} );
