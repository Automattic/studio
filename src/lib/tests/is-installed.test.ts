/**
 * @jest-environment node
 */
import { app } from 'electron';
import fs from 'fs';

jest.mock( 'fs', () => ( {
	existsSync: jest.fn(),
	readdirSync: jest.fn(),
} ) );

jest.mock( 'electron', () => ( {
	app: {
		getPath: jest.fn(),
	},
} ) );

describe( 'isInstalled', () => {
	let isInstalled: ( key: string ) => boolean;
	let mockPaths: string[];

	beforeEach( () => {
		jest.resetAllMocks();
		mockPaths = [];

		( fs.existsSync as jest.Mock ).mockImplementation( ( testPath: string ) => {
			const normalizedTestPath = testPath.replace( /\\/g, '/' );
			const normalizedMockPaths = mockPaths.map( ( p ) => p.replace( /\\/g, '/' ) );
			return normalizedMockPaths.includes( normalizedTestPath );
		} );

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
			Object.defineProperty( process, 'platform', { value: 'win32' } );
			process.env.ProgramFiles = 'D:\\Program Files';
			// Re-import the module after setting the environment variable
			jest.isolateModules( () => {
				const module = require( '../is-installed' );
				isInstalled = module.isInstalled;
			} );
		} );

		it( 'detects VS Code installed in Program Files', () => {
			mockPaths = [ 'D:\\Program Files\\Microsoft VS Code' ];

			expect( isInstalled( 'vscode' ) ).toBe( true );
		} );

		it( 'detects VS Code installed in AppData', () => {
			mockPaths = [ 'C:\\mock\\AppData\\Local\\Programs\\Microsoft VS Code' ];
			expect( isInstalled( 'vscode' ) ).toBe( true );
		} );

		it( 'detects PhpStorm with version-specific folder', () => {
			mockPaths = [ 'D:\\Program Files\\JetBrains', 'D:\\Program Files\\JetBrains\\PhpStorm' ];

			( fs.readdirSync as jest.Mock ).mockReturnValue( [ 'PhpStorm 2023.1', 'WebStorm 2023.1' ] );

			expect( isInstalled( 'phpstorm' ) ).toBe( true );
		} );

		it( 'returns false for Nova on Windows (Mac-only)', () => {
			mockPaths = [];
			expect( isInstalled( 'nova' ) ).toBe( false );
		} );

		it( 'falls back to default Program Files path when environment variable is not set', () => {
			delete process.env.ProgramFiles;

			// Re-import the module after setting the environment variable
			jest.isolateModules( () => {
				const module = require( '../is-installed' );
				isInstalled = module.isInstalled;
			} );

			mockPaths = [ 'C:\\Program Files\\Microsoft VS Code' ];
			expect( isInstalled( 'vscode' ) ).toBe( true );
		} );
	} );
} );
