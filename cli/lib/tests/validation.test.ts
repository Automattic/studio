import fs from 'fs';
import path from 'path';
import { calculateDirectorySize, isWordPressDirectory } from 'common/lib/fs-utils';
import { validateReadSitePath, validateSiteSize } from 'cli/lib/validation';

jest.mock( 'fs' );
jest.mock( 'path' );
jest.mock( 'common/lib/fs-utils', () => ( {
	calculateDirectorySize: jest.fn(),
	isWordPressDirectory: jest.fn(),
} ) );

describe( 'Validation Module', () => {
	const mockSiteFolder = '/mock/site';

	beforeEach( () => {
		jest.clearAllMocks();
		( path.join as jest.Mock ).mockImplementation( ( ...args ) => args.join( '/' ) );
		( fs.existsSync as jest.Mock ).mockReturnValue( true );
		( fs.statSync as jest.Mock ).mockReturnValue( { isDirectory: () => true } );
		( isWordPressDirectory as jest.Mock ).mockReturnValue( true );
		( calculateDirectorySize as jest.Mock ).mockResolvedValue( 1024 * 1024 * 1024 ); // 1GB
	} );

	describe( 'validateReadSitePath', () => {
		it( 'should return invalid result if site folder does not exist', () => {
			( fs.existsSync as jest.Mock ).mockReturnValue( false );

			const result = validateReadSitePath( mockSiteFolder );
			expect( result.valid ).toBe( false );
			expect( result.error ).toContain( `Folder not found: ${ mockSiteFolder }` );
		} );

		it( 'should return valid result for a valid WordPress directory', () => {
			( fs.existsSync as jest.Mock ).mockReturnValue( true );
			( fs.statSync as jest.Mock ).mockReturnValue( { isDirectory: () => true } );
			( isWordPressDirectory as jest.Mock ).mockReturnValue( true );

			const result = validateReadSitePath( mockSiteFolder );
			expect( result.valid ).toBe( true );
			expect( result.error ).toBeUndefined();
			expect( isWordPressDirectory ).toHaveBeenCalledWith( mockSiteFolder );
		} );

		it( 'should return invalid result for an invalid WordPress directory', () => {
			( fs.existsSync as jest.Mock ).mockReturnValue( true );
			( fs.statSync as jest.Mock ).mockReturnValue( { isDirectory: () => true } );
			( isWordPressDirectory as jest.Mock ).mockReturnValue( false );

			const result = validateReadSitePath( mockSiteFolder );
			expect( result.valid ).toBe( false );
			expect( result.error ).toContain( 'Please ensure it contains a wp-content directory' );
			expect( isWordPressDirectory ).toHaveBeenCalledWith( mockSiteFolder );
		} );

		it( 'should return invalid result if path is not a directory', () => {
			( fs.existsSync as jest.Mock ).mockReturnValue( true );
			( fs.statSync as jest.Mock ).mockReturnValue( { isDirectory: () => false } );

			const result = validateReadSitePath( mockSiteFolder );
			expect( result.valid ).toBe( false );
			expect( result.error ).toBe( 'Path must be a directory' );
		} );
	} );

	describe( 'validateSiteSize', () => {
		it( 'should return invalid result if the site exceeds size limit', async () => {
			( calculateDirectorySize as jest.Mock ).mockResolvedValue( 3 * 1024 * 1024 * 1024 ); // 3GB

			const result = await validateSiteSize( mockSiteFolder );
			expect( result.valid ).toBe( false );
			expect( result.error ).toContain(
				'Your site exceeds the 2 GB size limit. Please, consider removing unnecessary media files, plugins, or themes from wp-content.'
			);
			expect( calculateDirectorySize ).toHaveBeenCalledWith( mockSiteFolder + '/wp-content' );
		} );

		it( 'should return valid result for a WordPress site within size limit', async () => {
			( calculateDirectorySize as jest.Mock ).mockResolvedValue( 1024 * 1024 * 1024 ); // 1GB

			const result = await validateSiteSize( mockSiteFolder );
			expect( result.valid ).toBe( true );
			expect( result.error ).toBeUndefined();
			expect( calculateDirectorySize ).toHaveBeenCalledWith( mockSiteFolder + '/wp-content' );
		} );
	} );
} );
