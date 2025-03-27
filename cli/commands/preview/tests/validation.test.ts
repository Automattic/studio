import fs from 'fs';
import path from 'path';
import { validateSiteFolder } from 'cli/commands/preview/lib/validation';
import { LoggerError } from 'cli/logger';

// Mock ora
jest.mock( 'ora', () => {
	return {
		__esModule: true,
		default: () => ( {
			start: jest.fn().mockReturnThis(),
			stop: jest.fn().mockReturnThis(),
			succeed: jest.fn().mockReturnThis(),
			fail: jest.fn().mockReturnThis(),
		} ),
	};
} );

jest.mock( 'fs' );
jest.mock( 'path' );

describe( 'Validation Module', () => {
	const mockSiteFolder = '/mock/site';
	const mockWpContentPath = '/mock/site/wp-content';
	const mockWpIncludesPath = '/mock/site/wp-includes';
	const mockWpLoadPath = '/mock/site/wp-load.php';
	const mockAction = 'test-action';

	beforeEach( () => {
		jest.clearAllMocks();
		( path.join as jest.Mock ).mockImplementation( ( ...args ) => args.join( '/' ) );
	} );

	it( 'should throw LoggerError if site folder does not exist', () => {
		( fs.existsSync as jest.Mock ).mockReturnValue( false );

		expect( () => validateSiteFolder( mockSiteFolder, mockAction ) ).toThrow( LoggerError );
		expect( () => validateSiteFolder( mockSiteFolder, mockAction ) ).toThrow(
			`Folder not found: ${ mockSiteFolder }`
		);
	} );

	it( 'should return true for a full WordPress installation', () => {
		( fs.existsSync as jest.Mock ).mockImplementation( ( filePath: string ) => {
			return [ mockSiteFolder, mockWpContentPath, mockWpIncludesPath, mockWpLoadPath ].includes(
				filePath
			);
		} );

		const result = validateSiteFolder( mockSiteFolder, mockAction );
		expect( result ).toBe( true );
	} );

	it( 'should return true for a wp-content only directory', () => {
		( fs.existsSync as jest.Mock ).mockImplementation( ( filePath: string ) => {
			return [ mockSiteFolder, mockWpContentPath ].includes( filePath );
		} );

		const result = validateSiteFolder( mockSiteFolder, mockAction );
		expect( result ).toBe( true );
	} );

	it( 'should throw LoggerError for a directory without wp-content', () => {
		( fs.existsSync as jest.Mock ).mockImplementation( ( filePath: string ) => {
			return filePath === mockSiteFolder;
		} );

		expect( () => validateSiteFolder( mockSiteFolder, mockAction ) ).toThrow( LoggerError );
		expect( () => validateSiteFolder( mockSiteFolder, mockAction ) ).toThrow(
			/Please ensure it contains a wp-content directory/
		);
	} );

	it( 'should throw LoggerError even if wp-includes exists without wp-content', () => {
		( fs.existsSync as jest.Mock ).mockImplementation( ( filePath: string ) => {
			return [ mockSiteFolder, mockWpIncludesPath ].includes( filePath );
		} );

		expect( () => validateSiteFolder( mockSiteFolder, mockAction ) ).toThrow( LoggerError );
		expect( () => validateSiteFolder( mockSiteFolder, mockAction ) ).toThrow(
			/Please ensure it contains a wp-content directory/
		);
	} );

	it( 'should throw LoggerError even if wp-load.php exists without wp-content', () => {
		( fs.existsSync as jest.Mock ).mockImplementation( ( filePath: string ) => {
			return [ mockSiteFolder, mockWpLoadPath ].includes( filePath );
		} );

		expect( () => validateSiteFolder( mockSiteFolder, mockAction ) ).toThrow( LoggerError );
		expect( () => validateSiteFolder( mockSiteFolder, mockAction ) ).toThrow(
			/Please ensure it contains a wp-content directory/
		);
	} );
} );
