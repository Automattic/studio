import fs from 'fs';
import path from 'path';
import {
	calculateDirectorySizeForArchive,
	isWordPressDirectory,
} from '@studio/common/lib/fs-utils';
import { vi } from 'vitest';
import { validateSiteSize } from 'cli/lib/validation';
import { LoggerError } from 'cli/logger';

vi.mock( 'fs' );
vi.mock( 'path', () => ( {
	default: {
		join: vi.fn(),
	},
} ) );
vi.mock( '@studio/common/lib/fs-utils', () => ( {
	calculateDirectorySizeForArchive: vi.fn(),
	isWordPressDirectory: vi.fn(),
} ) );

describe( 'Validation Module', () => {
	const mockSiteFolder = '/mock/site';

	beforeEach( () => {
		vi.clearAllMocks();
		vi.mocked( path.join ).mockImplementation( ( ...args ) => args.join( '/' ) );
		vi.mocked( fs.existsSync ).mockReturnValue( true );
		vi.mocked( isWordPressDirectory ).mockReturnValue( true );
		vi.mocked( calculateDirectorySizeForArchive ).mockResolvedValue( 1024 * 1024 * 1024 ); // 1GB
	} );

	describe( 'validateSiteSize', () => {
		it( 'should throw an error if the site exceeds size limit', async () => {
			vi.mocked( calculateDirectorySizeForArchive ).mockResolvedValue( 3 * 1024 * 1024 * 1024 ); // 3GB

			await expect( validateSiteSize( mockSiteFolder ) ).rejects.toThrow( LoggerError );
			await expect( validateSiteSize( mockSiteFolder ) ).rejects.toThrow(
				'Your site exceeds the 2 GB size limit. Please, consider removing unnecessary media files, plugins, or themes from wp-content.'
			);
			expect( calculateDirectorySizeForArchive ).toHaveBeenCalledWith(
				mockSiteFolder + '/wp-content'
			);
		} );

		it( 'should return true for a valid WordPress site within size limit', async () => {
			vi.mocked( calculateDirectorySizeForArchive ).mockResolvedValue( 1024 * 1024 * 1024 ); // 1GB

			expect( await validateSiteSize( mockSiteFolder ) ).toBe( true );
			expect( calculateDirectorySizeForArchive ).toHaveBeenCalledWith(
				mockSiteFolder + '/wp-content'
			);
		} );
	} );
} );
