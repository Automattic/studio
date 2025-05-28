import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import archiver from 'archiver';
import { createArchive, cleanup } from 'cli/lib/archive';

jest.mock( 'fs' );
jest.mock( 'fs/promises' );
jest.mock( 'path' );
jest.mock( 'archiver' );

describe( 'Archive Module', () => {
	const mockSiteFolder = '/mock/site/folder';
	const mockArchivePath = '/mock/archive.zip';
	const mockWpContentPath = '/mock/site/folder/wp-content';
	const mockWpConfigPath = '/mock/site/folder/wp-config.php';
	const mockDirectoryContents = [
		'/mock/site/wp-content/plugins/my-plugin',
		'/mock/site/wp-content/plugins/my-plugin/my-plugin.php',
		'/mock/site/wp-content/plugins/my-symlinked-plugin.php',
	];
	const mockSymLinkedFilePath = '/mock/temp/symlinked-file.txt';

	const mockArchiver = {
		pipe: jest.fn(),
		directory: jest.fn(),
		file: jest.fn(),
		finalize: jest.fn().mockResolvedValue( undefined ),
		on: jest.fn(),
	};

	const mockWriteStream = {
		on: jest.fn(),
	};

	beforeEach( () => {
		jest.clearAllMocks();
		( archiver as unknown as jest.Mock ).mockReturnValue( mockArchiver );
		( fs.createWriteStream as unknown as jest.Mock ).mockReturnValue( mockWriteStream );
		( fsPromises.readdir as unknown as jest.Mock ).mockResolvedValue( mockDirectoryContents );
		( path.join as unknown as jest.Mock ).mockImplementation( ( ...args ) => args.join( '/' ) );
		( fs.lstatSync as unknown as jest.Mock ).mockReturnValue( {
			isFile: () => true,
		} );
	} );

	describe( 'createArchive', () => {
		it( 'should create an archive with wp-content directory', async () => {
			( fs.existsSync as jest.Mock ).mockReturnValue( false );

			mockWriteStream.on.mockImplementation( ( event, callback ) => {
				if ( event === 'close' ) {
					setTimeout( () => callback(), 0 );
				}
				return mockWriteStream;
			} );

			mockArchiver.on.mockImplementation( () => mockArchiver );

			const result = await createArchive( mockSiteFolder, mockArchivePath );

			expect( fs.createWriteStream ).toHaveBeenCalledWith( mockArchivePath );
			expect( archiver ).toHaveBeenCalledWith( 'zip', { zlib: { level: 9 } } );
			expect( mockArchiver.pipe ).toHaveBeenCalledWith( mockWriteStream );
			expect( fsPromises.readdir ).toHaveBeenCalledWith( mockWpContentPath, {
				recursive: true,
			} );
			expect( path.join ).toHaveBeenCalledWith( mockSiteFolder, 'wp-content' );
			expect( mockArchiver.file ).toHaveBeenCalled();
			expect( mockArchiver.finalize ).toHaveBeenCalled();
			expect( result ).toBe( mockArchiver );
		} );

		it( 'should handle symbolic links correctly', async () => {
			( fs.realpathSync as unknown as jest.Mock ).mockReturnValue( mockSymLinkedFilePath );
			( fs.lstatSync as unknown as jest.Mock ).mockReturnValue( {
				isFile: () => false,
				isSymbolicLink: () => true,
			} );

			mockWriteStream.on.mockImplementation( ( event, callback ) => {
				if ( event === 'close' ) {
					setTimeout( () => callback(), 0 );
				}
				return mockWriteStream;
			} );

			mockArchiver.on.mockImplementation( () => mockArchiver );

			await createArchive( mockSiteFolder, mockArchivePath );

			expect( fs.realpathSync ).toHaveBeenCalled();
			expect( fs.lstatSync ).toHaveBeenCalled();
			expect( mockArchiver.file ).toHaveBeenCalled();
		} );

		it( 'should include wp-config.php if it exists', async () => {
			( fs.existsSync as jest.Mock ).mockReturnValue( true );

			mockWriteStream.on.mockImplementation( ( event, callback ) => {
				if ( event === 'close' ) {
					setTimeout( () => callback(), 0 );
				}
				return mockWriteStream;
			} );

			mockArchiver.on.mockImplementation( () => mockArchiver );

			await createArchive( mockSiteFolder, mockArchivePath );

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

			await expect( createArchive( mockSiteFolder, mockArchivePath ) ).rejects.toThrow(
				'Archive error'
			);
		} );
	} );

	describe( 'cleanup', () => {
		beforeEach( () => {
			jest.useFakeTimers();
		} );

		afterEach( () => {
			jest.useRealTimers();
		} );

		it( 'should remove the archive file if it exists', async () => {
			( fs.existsSync as jest.Mock ).mockReturnValue( true );

			const cleanupPromise = cleanup( mockArchivePath );
			jest.runAllTimers();
			await cleanupPromise;

			expect( fs.existsSync ).toHaveBeenCalledWith( mockArchivePath );
			expect( fs.unlinkSync ).toHaveBeenCalledWith( mockArchivePath );
		} );

		it( 'should not attempt to remove the file if it does not exist', async () => {
			( fs.existsSync as jest.Mock ).mockReturnValue( false );

			const cleanupPromise = cleanup( mockArchivePath );
			jest.runAllTimers();
			await cleanupPromise;

			expect( fs.existsSync ).toHaveBeenCalledWith( mockArchivePath );
			expect( fs.unlinkSync ).not.toHaveBeenCalled();
		} );
	} );
} );
