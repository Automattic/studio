import fs from 'fs';
import path from 'path';
import { createDeployIgnoreFilter } from '@studio/common/lib/deploy-ignore';
import { STUDIO_LOADER_MU_PLUGIN_FILENAME } from '@studio/common/lib/mu-plugins';
import { ZipArchive } from 'archiver';
import { glob } from 'glob';
import { vi } from 'vitest';
import { archiveSiteContent, cleanup } from 'cli/lib/archive';

vi.mock( 'fs' );
vi.mock( 'path', () => ( {
	default: {
		join: vi.fn(),
	},
} ) );
vi.mock( 'archiver', () => ( {
	ZipArchive: vi.fn(),
} ) );
vi.mock( 'glob', () => ( {
	glob: vi.fn(),
} ) );
vi.mock( '@studio/common/lib/deploy-ignore', () => ( {
	createDeployIgnoreFilter: vi.fn(),
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

	// Makes `glob` resolve to the given wp-content-relative file paths.
	function mockGlobResults( relativePaths: string[] ): void {
		vi.mocked( glob as unknown as ( ...args: unknown[] ) => Promise< string[] > ).mockResolvedValue(
			relativePaths
		);
	}

	// Resolves the output stream's 'close' event so archiveSiteContent settles.
	function resolveOnClose(): void {
		mockWriteStream.on.mockImplementation( ( event, callback ) => {
			if ( event === 'close' ) {
				setTimeout( () => callback(), 0 );
			}
			return mockWriteStream;
		} );
		mockArchiver.on.mockImplementation( () => mockArchiver );
	}

	beforeEach( () => {
		vi.clearAllMocks();
		mockArchiver = createMockArchiver();
		mockWriteStream = createMockWriteStream();
		// `new ZipArchive()` must return our mock; a regular function is
		// constructable (an arrow function is not), so use one here.
		vi.mocked( ZipArchive ).mockImplementation( function (): ZipArchive {
			return mockArchiver as unknown as ZipArchive;
		} );
		vi.mocked( fs.createWriteStream ).mockReturnValue(
			mockWriteStream as unknown as ReturnType< typeof fs.createWriteStream >
		);
		vi.mocked( path.join ).mockImplementation( ( ...args ) => args.join( '/' ) );
		// Default to an "ignore nothing" filter.
		vi.mocked( createDeployIgnoreFilter ).mockResolvedValue( {
			ignores: () => false,
		} as unknown as Awaited< ReturnType< typeof createDeployIgnoreFilter > > );
		// Default to an empty wp-content; individual tests override as needed.
		mockGlobResults( [] );
	} );

	describe( 'createArchive', () => {
		it( 'should create a zip archive and stream it to the output file', async () => {
			vi.mocked( fs.existsSync ).mockReturnValue( false );
			resolveOnClose();

			const result = await archiveSiteContent( mockSiteFolder, mockArchivePath );

			expect( fs.createWriteStream ).toHaveBeenCalledWith( mockArchivePath );
			expect( ZipArchive ).toHaveBeenCalledWith( {
				zlib: { level: 9 },
			} );
			expect( mockArchiver.pipe ).toHaveBeenCalledWith( mockWriteStream );
			expect( mockArchiver.directory ).not.toHaveBeenCalled();
			expect( mockArchiver.finalize ).toHaveBeenCalled();
			expect( result ).toBe( mockArchiver );
		} );

		it( 'should enumerate wp-content following symlinks', async () => {
			vi.mocked( fs.existsSync ).mockReturnValue( false );
			resolveOnClose();

			await archiveSiteContent( mockSiteFolder, mockArchivePath );

			expect( glob ).toHaveBeenCalledWith(
				'**/*',
				expect.objectContaining( {
					cwd: mockWpContentPath,
					dot: true,
					follow: true,
					nodir: true,
					posix: true,
				} )
			);
		} );

		it( 'should add each globbed wp-content file individually', async () => {
			vi.mocked( fs.existsSync ).mockReturnValue( false );
			mockGlobResults( [ 'index.php', 'plugins/my-plugin.php' ] );
			resolveOnClose();

			await archiveSiteContent( mockSiteFolder, mockArchivePath );

			expect( mockArchiver.file ).toHaveBeenCalledWith( `${ mockWpContentPath }/index.php`, {
				name: 'wp-content/index.php',
			} );
			expect( mockArchiver.file ).toHaveBeenCalledWith(
				`${ mockWpContentPath }/plugins/my-plugin.php`,
				{ name: 'wp-content/plugins/my-plugin.php' }
			);
		} );

		it( 'should skip deploy-ignored entries and the Studio loader mu-plugin', async () => {
			vi.mocked( fs.existsSync ).mockReturnValue( false );
			vi.mocked( createDeployIgnoreFilter ).mockResolvedValue( {
				ignores: ( p: string ) => p === 'wp-content/debug.log',
			} as unknown as Awaited< ReturnType< typeof createDeployIgnoreFilter > > );
			mockGlobResults( [
				'keep.php',
				'debug.log',
				`mu-plugins/${ STUDIO_LOADER_MU_PLUGIN_FILENAME }`,
			] );
			resolveOnClose();

			await archiveSiteContent( mockSiteFolder, mockArchivePath );

			const archivedNames = mockArchiver.file.mock.calls.map( ( call ) => call[ 1 ].name );
			expect( archivedNames ).toContain( 'wp-content/keep.php' );
			expect( archivedNames ).not.toContain( 'wp-content/debug.log' );
			expect( archivedNames ).not.toContain(
				`wp-content/mu-plugins/${ STUDIO_LOADER_MU_PLUGIN_FILENAME }`
			);
		} );

		it( 'should include wp-config.php if it exists', async () => {
			vi.mocked( fs.existsSync ).mockReturnValue( true );
			resolveOnClose();

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
