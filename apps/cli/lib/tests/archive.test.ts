import fs from 'fs';
import path from 'path';
import { STUDIO_LOADER_MU_PLUGIN_FILENAME } from '@studio/common/lib/mu-plugins';
import { ZipArchive } from 'archiver';
import { glob } from 'glob';
import { vol } from 'memfs';
import { vi } from 'vitest';
import { archiveSiteContent, cleanup } from 'cli/lib/archive';

vi.mock( 'fs' );
vi.mock( 'archiver', () => ( {
	ZipArchive: vi.fn(),
} ) );
vi.mock( 'glob', () => ( {
	glob: vi.fn(),
} ) );

describe( 'Archive Module', () => {
	const mockSiteFolder = '/mock/site/folder';
	const mockArchivePath = '/mock/archive.zip';
	const mockWpContentPath = path.join( mockSiteFolder, 'wp-content' );
	const mockWpConfigPath = path.join( mockSiteFolder, 'wp-config.php' );

	let mockArchiver: ReturnType< typeof createMockArchiver >;

	function createMockArchiver(): {
		pipe: ReturnType< typeof vi.fn >;
		directory: ReturnType< typeof vi.fn >;
		file: ReturnType< typeof vi.fn >;
		finalize: ReturnType< typeof vi.fn >;
		on: ReturnType< typeof vi.fn >;
	} {
		return {
			// Ending the (real memfs) output stream makes it emit 'close', which is
			// what resolves archiveSiteContent. The real archiver would do this after
			// streaming the entries; the mock just ends it immediately.
			pipe: vi.fn( ( dest: { end: () => void } ) => {
				dest.end();
				return mockArchiver;
			} ),
			directory: vi.fn().mockReturnThis(),
			file: vi.fn().mockReturnThis(),
			finalize: vi.fn().mockResolvedValue( undefined ),
			on: vi.fn().mockReturnThis(),
		};
	}

	// Makes `glob` resolve to the given wp-content-relative file paths.
	function mockGlobResults( relativePaths: string[] ): void {
		vi.mocked( glob as unknown as ( ...args: unknown[] ) => Promise< string[] > ).mockResolvedValue(
			relativePaths
		);
	}

	function archivedNames(): unknown[] {
		return mockArchiver.file.mock.calls.map( ( call ) => call[ 1 ].name );
	}

	beforeEach( () => {
		vol.reset();
		// Parent directory for the archive's output write stream.
		vol.mkdirSync( '/mock', { recursive: true } );
		mockArchiver = createMockArchiver();
		// `new ZipArchive()` must return our mock; a regular function is
		// constructable (an arrow function is not), so use one here.
		vi.mocked( ZipArchive ).mockImplementation( function (): ZipArchive {
			return mockArchiver as unknown as ZipArchive;
		} );
		// Default to an empty wp-content; individual tests override as needed.
		mockGlobResults( [] );
	} );

	describe( 'createArchive', () => {
		it( 'should create a zip archive and stream it to the output file', async () => {
			const result = await archiveSiteContent( mockSiteFolder, mockArchivePath );

			expect( ZipArchive ).toHaveBeenCalledWith( { zlib: { level: 9 } } );
			expect( mockArchiver.directory ).not.toHaveBeenCalled();
			expect( mockArchiver.finalize ).toHaveBeenCalled();
			expect( result ).toBe( mockArchiver );
		} );

		it( 'should enumerate wp-content following symlinks', async () => {
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
			vol.fromJSON( {
				[ path.join( mockWpContentPath, 'index.php' ) ]: '<?php',
				[ path.join( mockWpContentPath, 'plugins', 'my-plugin.php' ) ]: '<?php',
			} );
			mockGlobResults( [ 'index.php', 'plugins/my-plugin.php' ] );

			await archiveSiteContent( mockSiteFolder, mockArchivePath );

			expect( mockArchiver.file ).toHaveBeenCalledWith(
				fs.realpathSync( path.join( mockWpContentPath, 'index.php' ) ),
				{ name: 'wp-content/index.php' }
			);
			expect( mockArchiver.file ).toHaveBeenCalledWith(
				fs.realpathSync( path.join( mockWpContentPath, 'plugins', 'my-plugin.php' ) ),
				{ name: 'wp-content/plugins/my-plugin.php' }
			);
		} );

		it( 'should skip deploy-ignored entries and the Studio loader mu-plugin', async () => {
			// A real .deployignore in the volume drives the real ignore filter.
			vol.fromJSON( {
				[ path.join( mockSiteFolder, '.deployignore' ) ]: 'debug.log\n',
				[ path.join( mockWpContentPath, 'keep.php' ) ]: '<?php',
				[ path.join( mockWpContentPath, 'debug.log' ) ]: 'log',
				[ path.join( mockWpContentPath, 'mu-plugins', STUDIO_LOADER_MU_PLUGIN_FILENAME ) ]: '<?php',
			} );
			mockGlobResults( [
				'keep.php',
				'debug.log',
				`mu-plugins/${ STUDIO_LOADER_MU_PLUGIN_FILENAME }`,
			] );

			await archiveSiteContent( mockSiteFolder, mockArchivePath );

			expect( archivedNames() ).toContain( 'wp-content/keep.php' );
			expect( archivedNames() ).not.toContain( 'wp-content/debug.log' );
			expect( archivedNames() ).not.toContain(
				`wp-content/mu-plugins/${ STUDIO_LOADER_MU_PLUGIN_FILENAME }`
			);
		} );

		it( 'should include wp-config.php when it exists', async () => {
			vol.fromJSON( { [ mockWpConfigPath ]: '<?php' } );

			await archiveSiteContent( mockSiteFolder, mockArchivePath );

			expect( mockArchiver.file ).toHaveBeenCalledWith( mockWpConfigPath, {
				name: 'wp-config.php',
			} );
		} );

		it( 'should not include wp-config.php when it does not exist', async () => {
			await archiveSiteContent( mockSiteFolder, mockArchivePath );

			expect( archivedNames() ).not.toContain( 'wp-config.php' );
		} );

		it( 'should reject if archiver emits an error', async () => {
			// Don't end the output stream, so the rejection (not 'close') settles it.
			mockArchiver.pipe.mockReturnValue( mockArchiver );
			const mockError = new Error( 'Archive error' );
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

		it( 'should remove the archive file if it exists', async () => {
			vol.fromJSON( { [ mockArchivePath ]: 'data' } );

			const cleanupPromise = cleanup( mockArchivePath );
			vi.runAllTimers();
			await cleanupPromise;

			expect( vol.existsSync( mockArchivePath ) ).toBe( false );
		} );

		it( 'should resolve without error if the file does not exist', async () => {
			const cleanupPromise = cleanup( mockArchivePath );
			vi.runAllTimers();

			await expect( cleanupPromise ).resolves.toBeUndefined();
		} );
	} );
} );
