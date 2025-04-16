/**
 * @jest-environment node
 */
import { app } from 'electron';
import fs from 'fs';
import path from 'path';

// Mock the fs module
jest.mock( 'fs', () => ( {
	existsSync: jest.fn(),
	readdirSync: jest.fn(),
} ) );

// Mock the electron app module
jest.mock( 'electron', () => ( {
	app: {
		getPath: jest.fn(),
	},
} ) );

describe( 'isInstalled', () => {
	let isInstalled: ( key: keyof InstalledApps ) => boolean;
	let mockPaths: string[];

	// Reset mocks before each test
	beforeEach( () => {
		jest.resetAllMocks();
		mockPaths = [];

		// Mock fs.existsSync to check against our mockPaths array
		( fs.existsSync as jest.Mock ).mockImplementation( ( testPath: string ) => {
			return mockPaths.includes( testPath );
		} );

		// Mock app.getPath
		( app.getPath as jest.Mock ).mockImplementation( ( name: string ) => {
			switch ( name ) {
				case 'home':
					return '/mock/home/path';
				case 'appData':
					return process.platform === 'win32' ? 'C:\\mock\\AppData' : '/mock/home/path/.config';
				default:
					return '';
			}
		} );
	} );

	describe( 'on macOS (darwin)', () => {
		beforeEach( () => {
			// Mock process.platform to be 'darwin'
			Object.defineProperty( process, 'platform', { value: 'darwin' } );
			// Re-import the module to ensure platform-specific paths are set up
			jest.isolateModules( () => {
				const module = require( '../is-installed' );
				isInstalled = module.isInstalled;
			} );
		} );

		it( 'detects VS Code installed in system Applications', () => {
			mockPaths = [ '/Applications/Visual Studio Code.app' ];
			expect( isInstalled( 'vscode' ) ).toBe( true );
		} );

		it( 'detects VS Code installed in user Applications', () => {
			mockPaths = [ '/mock/home/path/Applications/Visual Studio Code.app' ];
			expect( isInstalled( 'vscode' ) ).toBe( true );
		} );

		it( 'returns false when VS Code is not installed', () => {
			mockPaths = [];
			expect( isInstalled( 'vscode' ) ).toBe( false );
		} );

		it( 'detects PhpStorm installed', () => {
			mockPaths = [ '/Applications/PhpStorm.app' ];
			expect( isInstalled( 'phpstorm' ) ).toBe( true );
		} );

		it( 'detects Nova installed (Mac-only)', () => {
			mockPaths = [ '/Applications/Nova.app' ];
			expect( isInstalled( 'nova' ) ).toBe( true );
		} );
	} );

	describe( 'on Windows (win32)', () => {
		beforeEach( () => {
			// Mock process.platform to be 'win32'
			Object.defineProperty( process, 'platform', { value: 'win32' } );
			// Re-import the module to ensure platform-specific paths are set up
			jest.isolateModules( () => {
				const module = require( '../is-installed' );
				isInstalled = module.isInstalled;
			} );
		} );

		it( 'detects VS Code installed in Program Files', () => {
			mockPaths = [ 'C:\\Program Files\\Microsoft VS Code' ];
			expect( isInstalled( 'vscode' ) ).toBe( true );
		} );

		it( 'detects VS Code installed in AppData', () => {
			mockPaths = [ path.join( 'C:\\mock\\AppData', 'Local\\Programs\\Microsoft VS Code' ) ];
			expect( isInstalled( 'vscode' ) ).toBe( true );
		} );

		it( 'detects PhpStorm with version-specific folder', () => {
			const jetbrainsDir = 'C:\\Program Files\\JetBrains';
			const versionSpecificPath = path.join( jetbrainsDir, 'PhpStorm 2023.1' );

			mockPaths = [ jetbrainsDir, versionSpecificPath, 'C:\\Program Files\\JetBrains\\PhpStorm' ];

			( fs.readdirSync as jest.Mock ).mockReturnValue( [ 'PhpStorm 2023.1', 'WebStorm 2023.1' ] );

			expect( isInstalled( 'phpstorm' ) ).toBe( true );
		} );

		it( 'returns false for Nova on Windows (Mac-only)', () => {
			mockPaths = [];
			expect( isInstalled( 'nova' ) ).toBe( false );
		} );
	} );

	describe( 'on Linux', () => {
		beforeEach( () => {
			// Mock process.platform to be 'linux'
			Object.defineProperty( process, 'platform', { value: 'linux' } );
			// Re-import the module to ensure platform-specific paths are set up
			jest.isolateModules( () => {
				const module = require( '../is-installed' );
				isInstalled = module.isInstalled;
			} );
		} );

		it( 'detects VS Code installed in /usr/share/code', () => {
			mockPaths = [ '/usr/share/code' ];
			expect( isInstalled( 'vscode' ) ).toBe( true );
		} );

		it( 'detects VS Code installed in user directory', () => {
			mockPaths = [ path.join( '/mock/home/path', '.local/share/code' ) ];
			expect( isInstalled( 'vscode' ) ).toBe( true );
		} );

		it( 'detects VS Code installed via snap', () => {
			mockPaths = [ '/snap/code' ];
			expect( isInstalled( 'vscode' ) ).toBe( true );
		} );

		it( 'detects VS Code installed as executable', () => {
			mockPaths = [ '/usr/bin/vscode' ];
			expect( isInstalled( 'vscode' ) ).toBe( true );
		} );

		it( 'returns false for Nova on Linux (Mac-only)', () => {
			mockPaths = [];
			expect( isInstalled( 'nova' ) ).toBe( false );
		} );
	} );
} );
