import fs from 'fs';
import path from 'path';
import { validateSiteFolder } from '../lib/validation';

jest.mock( 'fs' );
jest.mock( 'path' );

describe( 'Validation Module', () => {
	const mockSiteFolder = '/mock/site';
	const mockWpContentPath = '/mock/site/wp-content';
	const mockWpIncludesPath = '/mock/site/wp-includes';
	const mockWpLoadPath = '/mock/site/wp-load.php';

	beforeEach( () => {
		jest.clearAllMocks();
		( path.join as jest.Mock ).mockImplementation( ( ...args ) => args.join( '/' ) );
	} );

	it( 'should return error if site folder does not exist', () => {
		( fs.existsSync as jest.Mock ).mockReturnValue( false );

		const result = validateSiteFolder( mockSiteFolder );
		expect( result ).toBeInstanceOf( Error );
		expect( ( result as Error ).message ).toBe( `Folder not found: ${ mockSiteFolder }` );
	} );

	it( 'should return true for a full WordPress installation', () => {
		( fs.existsSync as jest.Mock ).mockImplementation( ( filePath: string ) => {
			return [ mockSiteFolder, mockWpContentPath, mockWpIncludesPath, mockWpLoadPath ].includes(
				filePath
			);
		} );

		const result = validateSiteFolder( mockSiteFolder );
		expect( result ).toBe( true );
	} );

	it( 'should return true for a wp-content only directory', () => {
		( fs.existsSync as jest.Mock ).mockImplementation( ( filePath: string ) => {
			return [ mockSiteFolder, mockWpContentPath ].includes( filePath );
		} );

		const result = validateSiteFolder( mockSiteFolder );
		expect( result ).toBe( true );
	} );

	it( 'should return error for a directory without wp-content', () => {
		( fs.existsSync as jest.Mock ).mockImplementation( ( filePath: string ) => {
			return filePath === mockSiteFolder;
		} );

		const result = validateSiteFolder( mockSiteFolder );
		expect( result ).toBeInstanceOf( Error );
		expect( ( result as Error ).message ).toContain(
			'Please ensure it contains a wp-content directory'
		);
	} );

	it( 'should check for wp-content directory even if wp-includes exists', () => {
		( fs.existsSync as jest.Mock ).mockImplementation( ( filePath: string ) => {
			return [ mockSiteFolder, mockWpIncludesPath ].includes( filePath );
		} );

		const result = validateSiteFolder( mockSiteFolder );
		expect( result ).toBeInstanceOf( Error );
		expect( ( result as Error ).message ).toContain(
			'Please ensure it contains a wp-content directory'
		);
	} );

	it( 'should check for wp-content directory even if wp-load.php exists', () => {
		( fs.existsSync as jest.Mock ).mockImplementation( ( filePath: string ) => {
			return [ mockSiteFolder, mockWpLoadPath ].includes( filePath );
		} );

		const result = validateSiteFolder( mockSiteFolder );
		expect( result ).toBeInstanceOf( Error );
		expect( ( result as Error ).message ).toContain(
			'Please ensure it contains a wp-content directory'
		);
	} );
} );
