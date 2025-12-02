import fs from 'fs';
import path from 'path';
import { calculateDirectorySize, isWordPressDirectory } from 'common/lib/fs-utils';
import { validateSiteSize } from 'cli/lib/validation';
import { LoggerError } from 'cli/logger';

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
		( isWordPressDirectory as jest.Mock ).mockReturnValue( true );
		( calculateDirectorySize as jest.Mock ).mockResolvedValue( 1024 * 1024 * 1024 ); // 1GB
	} );

	describe( 'validateSiteSize', () => {
		it( 'should throw an error if the site exceeds size limit', async () => {
			( calculateDirectorySize as jest.Mock ).mockResolvedValue( 3 * 1024 * 1024 * 1024 ); // 3GB

			await expect( validateSiteSize( mockSiteFolder ) ).rejects.toThrow( LoggerError );
			await expect( validateSiteSize( mockSiteFolder ) ).rejects.toThrow(
				'Your site exceeds the 2 GB size limit. Please, consider removing unnecessary media files, plugins, or themes from wp-content.'
			);
			expect( calculateDirectorySize ).toHaveBeenCalledWith( mockSiteFolder + '/wp-content' );
		} );

		it( 'should return true for a valid WordPress site within size limit', async () => {
			( calculateDirectorySize as jest.Mock ).mockResolvedValue( 1024 * 1024 * 1024 ); // 1GB

			expect( await validateSiteSize( mockSiteFolder ) ).toBe( true );
			expect( calculateDirectorySize ).toHaveBeenCalledWith( mockSiteFolder + '/wp-content' );
		} );
	} );
} );
