import fs from 'fs';
import path from 'path';
import { calculateDirectorySize } from 'common/lib/fs-utils';
import { isWordPressDirectory } from 'src/lib/fs-utils';
import { validateSiteFolder } from 'cli/lib/validation';
import { LoggerError } from 'cli/logger';

jest.mock( 'fs' );
jest.mock( 'path' );
jest.mock( 'src/lib/fs-utils' );
jest.mock( 'common/lib/fs-utils', () => ( {
	calculateDirectorySize: jest.fn(),
} ) );

describe( 'Validation Module', () => {
	const mockSiteFolder = '/mock/site';

	beforeEach( () => {
		jest.clearAllMocks();
		( path.join as jest.Mock ).mockImplementation( ( ...args ) => args.join( '/' ) );
		( fs.existsSync as jest.Mock ).mockReturnValue( true );
		( isWordPressDirectory as jest.Mock ).mockReturnValue( true );
		( calculateDirectorySize as jest.Mock ).mockResolvedValue( 1024 * 1024 * 1024 ); // 1GB
	} );

	it( 'should throw LoggerError if site folder does not exist', async () => {
		( fs.existsSync as jest.Mock ).mockReturnValue( false );

		await expect( validateSiteFolder( mockSiteFolder ) ).rejects.toThrow( LoggerError );
		await expect( validateSiteFolder( mockSiteFolder ) ).rejects.toThrow(
			`Folder not found: ${ mockSiteFolder }`
		);
	} );

	it( 'should return true for a valid WordPress directory', async () => {
		( fs.existsSync as jest.Mock ).mockReturnValue( true );
		( isWordPressDirectory as jest.Mock ).mockReturnValue( true );

		const result = await validateSiteFolder( mockSiteFolder );
		expect( result ).toBe( true );
		expect( isWordPressDirectory ).toHaveBeenCalledWith( mockSiteFolder );
	} );

	it( 'should throw LoggerError for an invalid WordPress directory', async () => {
		( fs.existsSync as jest.Mock ).mockReturnValue( true );
		( isWordPressDirectory as jest.Mock ).mockReturnValue( false );

		await expect( validateSiteFolder( mockSiteFolder ) ).rejects.toThrow( LoggerError );
		await expect( validateSiteFolder( mockSiteFolder ) ).rejects.toThrow(
			/Please ensure it contains a wp-content directory/
		);
		expect( isWordPressDirectory ).toHaveBeenCalledWith( mockSiteFolder );
	} );

	it( 'should throw an error if the site exceeds size limit', async () => {
		( fs.existsSync as jest.Mock ).mockReturnValue( true );
		( isWordPressDirectory as jest.Mock ).mockReturnValue( true );
		( calculateDirectorySize as jest.Mock ).mockResolvedValue( 3 * 1024 * 1024 * 1024 ); // 3GB

		await expect( validateSiteFolder( mockSiteFolder ) ).rejects.toThrow( LoggerError );
		await expect( validateSiteFolder( mockSiteFolder ) ).rejects.toThrow(
			'Your site exceeds the 2 GB size limit. Please, consider removing unnecessary media files, plugins, or themes from wp-content.'
		);
	} );

	it( 'should return true for a valid WordPress site within size limit', async () => {
		( fs.existsSync as jest.Mock ).mockReturnValue( true );
		( isWordPressDirectory as jest.Mock ).mockReturnValue( true );
		( calculateDirectorySize as jest.Mock ).mockResolvedValue( 1024 * 1024 * 1024 ); // 1GB

		expect( await validateSiteFolder( mockSiteFolder ) ).toBe( true );
	} );
} );
