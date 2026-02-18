import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import { vi } from 'vitest';
import { archiveSiteContent, cleanup } from 'cli/lib/archive';

vi.mock( 'fs', () => ( {
	default: {
		createWriteStream: vi.fn(),
		existsSync: vi.fn(),
		unlinkSync: vi.fn(),
	},
} ) );
vi.mock( 'path', () => ( {
	default: {
		join: vi.fn(),
	},
} ) );
vi.mock( 'archiver', () => ( {
	default: vi.fn(),
} ) );

describe( 'Archive Module', () => {
	const mockSiteFolder = '/mock/site/folder';
	const mockArchivePath = '/mock/archive.zip';
	const mockWpContentPath = '/mock/site/folder/wp-content';
	const mockWpConfigPath = '/mock/site/folder/wp-config.php';

	let mockArchiver: ReturnType< typeof createMockArchiver >;
	let mockWriteStream: ReturnType< typeof createMockWriteStream >;

	function createMockArchiver(): {
		pipe: ReturnType< typeof vi.fn >;
		directory: ReturnType< typeof vi.fn >;
		file: ReturnType< typeof vi.fn >;
		finalize: ReturnType< typeof vi.fn >;
		on: ReturnType< typeof vi.fn >;
	} {
		return {
			pipe: vi.fn().mockReturnThis(),
			directory: vi.fn().mockReturnThis(),
			file: vi.fn().mockReturnThis(),
			finalize: vi.fn().mockResolvedValue( undefined ),
			on: vi.fn().mockReturnThis(),
		};
	}

	function createMockWriteStream(): {
		on: ReturnType< typeof vi.fn >;
	} {
		return {
			on: vi.fn().mockReturnThis(),
		};
	}

	beforeEach( () => {
		vi.clearAllMocks();
		mockArchiver = createMockArchiver();
		mockWriteStream = createMockWriteStream();
		vi.mocked( archiver ).mockReturnValue(
			mockArchiver as unknown as ReturnType< typeof archiver >
		);
		vi.mocked( fs.createWriteStream ).mockReturnValue(
			mockWriteStream as unknown as ReturnType< typeof fs.createWriteStream >
		);
		vi.mocked( path.join ).mockImplementation( ( ...args ) => args.join( '/' ) );
	} );

	describe( 'createArchive', () => {
		it( 'should create an archive with wp-content directory', async () => {
			vi.mocked( fs.existsSync ).mockReturnValue( false );

			mockWriteStream.on.mockImplementation( ( event, callback ) => {
				if ( event === 'close' ) {
					setTimeout( () => callback(), 0 );
				}
				return mockWriteStream;
			} );

			mockArchiver.on.mockImplementation( () => mockArchiver );

			const result = await archiveSiteContent( mockSiteFolder, mockArchivePath );

			expect( fs.createWriteStream ).toHaveBeenCalledWith( mockArchivePath );
			expect( archiver ).toHaveBeenCalledWith( 'zip', {
				followSymlinks: true,
				zlib: { level: 9 },
			} );
			expect( mockArchiver.pipe ).toHaveBeenCalledWith( mockWriteStream );
			expect( path.join ).toHaveBeenCalledWith( mockSiteFolder, 'wp-content' );
			expect( mockArchiver.directory ).toHaveBeenCalledWith(
				mockWpContentPath,
				'wp-content',
				expect.any( Function )
			);
			expect( path.join ).toHaveBeenCalledWith( mockSiteFolder, 'wp-config.php' );
			expect( fs.existsSync ).toHaveBeenCalledWith( mockWpConfigPath );
			expect( mockArchiver.file ).not.toHaveBeenCalled();
			expect( mockArchiver.finalize ).toHaveBeenCalled();
			expect( result ).toBe( mockArchiver );
		} );

		it( 'should include wp-config.php if it exists', async () => {
			vi.mocked( fs.existsSync ).mockReturnValue( true );

			mockWriteStream.on.mockImplementation( ( event, callback ) => {
				if ( event === 'close' ) {
					setTimeout( () => callback(), 0 );
				}
				return mockWriteStream;
			} );

			mockArchiver.on.mockImplementation( () => mockArchiver );

			await archiveSiteContent( mockSiteFolder, mockArchivePath );

			expect( fs.existsSync ).toHaveBeenCalledWith( mockWpConfigPath );
			expect( mockArchiver.file ).toHaveBeenCalledWith( mockWpConfigPath, {
				name: 'wp-config.php',
			} );
		} );

		it( 'should reject if archiver emits an error', async () => {
			const mockError = new Error( 'Archive error' );

			mockWriteStream.on.mockReturnThis();

			mockArchiver.on.mockImplementation( ( event, callback ) => {
				if ( event === 'error' ) {
					setTimeout( () => callback( mockError ), 0 );
				}
				return mockArchiver;
			} );

			mockArchiver.finalize.mockRejectedValue( mockError );

			await expect( archiveSiteContent( mockSiteFolder, mockArchivePath ) ).rejects.toThrow(
				'Archive error'
			);
		} );
	} );

	describe( 'cleanup', () => {
		beforeEach( () => {
			vi.useFakeTimers();
		} );

		afterEach( () => {} );

		it( 'should remove the archive file if it exists', async () => {
			vi.mocked( fs.existsSync ).mockReturnValue( true );

			const cleanupPromise = cleanup( mockArchivePath );
			vi.runAllTimers();
			await cleanupPromise;

			expect( fs.existsSync ).toHaveBeenCalledWith( mockArchivePath );
			expect( fs.unlinkSync ).toHaveBeenCalledWith( mockArchivePath );
		} );

		it( 'should not attempt to remove the file if it does not exist', async () => {
			vi.mocked( fs.existsSync ).mockReturnValue( false );

			const cleanupPromise = cleanup( mockArchivePath );
			vi.runAllTimers();
			await cleanupPromise;

			expect( fs.existsSync ).toHaveBeenCalledWith( mockArchivePath );
			expect( fs.unlinkSync ).not.toHaveBeenCalled();
		} );
	} );
} );
