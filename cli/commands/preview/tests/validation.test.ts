import fs from 'fs';
import path from 'path';
import { isWordPressDirectory } from 'src/lib/fs-utils';
import { validateSiteFolder } from 'cli/commands/preview/lib/validation';
import { LoggerError } from 'cli/logger';

jest.mock( 'fs' );
jest.mock( 'path' );
jest.mock( 'src/lib/fs-utils' );

describe( 'Validation Module', () => {
	const mockSiteFolder = '/mock/site';

	beforeEach( () => {
		jest.clearAllMocks();
		( path.join as jest.Mock ).mockImplementation( ( ...args ) => args.join( '/' ) );
	} );

	it( 'should throw LoggerError if site folder does not exist', () => {
		( fs.existsSync as jest.Mock ).mockReturnValue( false );

		expect( () => validateSiteFolder( mockSiteFolder ) ).toThrow( LoggerError );
		expect( () => validateSiteFolder( mockSiteFolder ) ).toThrow(
			`Folder not found: ${ mockSiteFolder }`
		);
	} );

	it( 'should return true for a valid WordPress directory', () => {
		( fs.existsSync as jest.Mock ).mockReturnValue( true );
		( isWordPressDirectory as jest.Mock ).mockReturnValue( true );

		const result = validateSiteFolder( mockSiteFolder );
		expect( result ).toBe( true );
		expect( isWordPressDirectory ).toHaveBeenCalledWith( mockSiteFolder );
	} );

	it( 'should throw LoggerError for an invalid WordPress directory', () => {
		( fs.existsSync as jest.Mock ).mockReturnValue( true );
		( isWordPressDirectory as jest.Mock ).mockReturnValue( false );

		expect( () => validateSiteFolder( mockSiteFolder ) ).toThrow( LoggerError );
		expect( () => validateSiteFolder( mockSiteFolder ) ).toThrow(
			/Please ensure it contains a wp-content directory/
		);
		expect( isWordPressDirectory ).toHaveBeenCalledWith( mockSiteFolder );
	} );
} );
