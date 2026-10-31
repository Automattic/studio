import fs from 'fs';
import os from 'os';
import path from 'path';
import { STUDIO_LOADER_MU_PLUGIN_FILENAME } from '@studio/common/lib/mu-plugins';
import { ZipArchive } from 'archiver';
import { glob } from 'glob';
import { vol } from 'memfs';
import { vi } from 'vitest';
import { readActiveThemes } from 'cli/lib/active-themes';
import { archiveSiteContent, cleanup, getArchiveContentSize } from 'cli/lib/archive';

vi.mock( 'fs' );
vi.mock( 'archiver', () => ( {
	ZipArchive: vi.fn(),
} ) );
vi.mock( 'glob', () => ( {
	glob: vi.fn(),
} ) );
vi.mock( 'cli/lib/active-themes', () => ( {
	readActiveThemes: vi.fn(),
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
		vi.mocked( readActiveThemes ).mockResolvedValue( null );
	} );

	describe( 'createArchive', () => {
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
				{ name: 'wp-content/index.php', store: false }
			);
			expect( mockArchiver.file ).toHaveBeenCalledWith(
				fs.realpathSync( path.join( mockWpContentPath, 'plugins', 'my-plugin.php' ) ),
				{ name: 'wp-content/plugins/my-plugin.php', store: false }
			);
		} );

		it( 'should store already-compressed files without compressing them again', async () => {
			vol.fromJSON( {
				[ path.join( mockWpContentPath, 'uploads', 'photo.JPG' ) ]: 'jpg',
				[ path.join( mockWpContentPath, 'themes', 'style.css' ) ]: 'css',
			} );
			mockGlobResults( [ 'uploads/photo.JPG', 'themes/style.css' ] );

			await archiveSiteContent( mockSiteFolder, mockArchivePath );

			expect( mockArchiver.file ).toHaveBeenCalledWith(
				fs.realpathSync( path.join( mockWpContentPath, 'uploads', 'photo.JPG' ) ),
				{ name: 'wp-content/uploads/photo.JPG', store: true }
			);
			expect( mockArchiver.file ).toHaveBeenCalledWith(
				fs.realpathSync( path.join( mockWpContentPath, 'themes', 'style.css' ) ),
				{ name: 'wp-content/themes/style.css', store: false }
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

		it( 'should leave out inactive themes, keeping the active theme and its parent', async () => {
			const files = [
				'themes/index.php',
				'themes/child/style.css',
				'themes/parent/style.css',
				'themes/twentytwentyfive/style.css',
			];
			vol.fromJSON(
				Object.fromEntries( files.map( ( file ) => [ path.join( mockWpContentPath, file ), '' ] ) )
			);
			mockGlobResults( files );
			vi.mocked( readActiveThemes ).mockResolvedValue( new Set( [ 'child', 'parent' ] ) );

			await archiveSiteContent( mockSiteFolder, mockArchivePath );

			expect( archivedNames() ).toEqual( [
				'wp-content/themes/index.php',
				'wp-content/themes/child/style.css',
				'wp-content/themes/parent/style.css',
			] );
		} );

		it( 'should leave out files a pulled site links from its host, keeping its own', async () => {
			const raw = path.join( os.homedir(), '.studio', 'pulls', 'site-id', 'raw' );
			vol.fromJSON( {
				[ path.join( raw, 'wordpress/plugins/jetpack/latest/jetpack.php' ) ]: '<?php',
				[ path.join( mockWpContentPath, 'plugins/my-plugin/my-plugin.php' ) ]: '<?php',
			} );
			vol.symlinkSync(
				path.join( raw, 'wordpress/plugins/jetpack/latest' ),
				path.join( mockWpContentPath, 'plugins/jetpack' )
			);
			mockGlobResults( [ 'plugins/jetpack/jetpack.php', 'plugins/my-plugin/my-plugin.php' ] );

			await archiveSiteContent( mockSiteFolder, mockArchivePath );

			expect( archivedNames() ).toEqual( [ 'wp-content/plugins/my-plugin/my-plugin.php' ] );
		} );

		it( 'should leave out plugins WordPress.com provides, keeping other plugins', async () => {
			const files = [ 'plugins/jetpack/jetpack.php', 'plugins/my-plugin/my-plugin.php' ];
			vol.fromJSON(
				Object.fromEntries( files.map( ( file ) => [ path.join( mockWpContentPath, file ), '' ] ) )
			);
			mockGlobResults( files );

			await archiveSiteContent( mockSiteFolder, mockArchivePath );

			expect( archivedNames() ).toEqual( [ 'wp-content/plugins/my-plugin/my-plugin.php' ] );
		} );

		it( 'should size only the files the archive holds', async () => {
			vol.fromJSON( {
				[ path.join( mockWpContentPath, 'plugins/jetpack/jetpack.php' ) ]: 'x'.repeat( 1000 ),
				[ path.join( mockWpContentPath, 'plugins/my-plugin/my-plugin.php' ) ]: 'x'.repeat( 10 ),
			} );
			mockGlobResults( [ 'plugins/jetpack/jetpack.php', 'plugins/my-plugin/my-plugin.php' ] );

			expect( await getArchiveContentSize( mockSiteFolder ) ).toBe( 10 );
		} );

		it( 'should skip a dangling symlink instead of aborting the archive', async () => {
			vol.fromJSON( {
				[ path.join( mockWpContentPath, 'index.php' ) ]: '<?php',
			} );
			// A broken symlink whose target was never created — mirrors the WP Cloud
			// `advanced-cache.php` drop-in that a reprint pull leaves dangling.
			vol.symlinkSync(
				path.join( mockWpContentPath, 'wordpress/drop-ins/advanced-cache.php' ),
				path.join( mockWpContentPath, 'advanced-cache.php' )
			);
			mockGlobResults( [ 'advanced-cache.php', 'index.php' ] );
			const warnSpy = vi.spyOn( console, 'warn' ).mockImplementation( () => {} );

			// Resolves (does not reject) and archives the good file, skipping the broken link.
			await expect( archiveSiteContent( mockSiteFolder, mockArchivePath ) ).resolves.toBe(
				mockArchiver
			);

			expect( archivedNames() ).toContain( 'wp-content/index.php' );
			expect( archivedNames() ).not.toContain( 'wp-content/advanced-cache.php' );
			expect( warnSpy ).toHaveBeenCalledWith(
				expect.stringContaining( 'wp-content/advanced-cache.php' )
			);
			warnSpy.mockRestore();
		} );

		it( 'should include wp-config.php when it exists', async () => {
			vol.fromJSON( { [ mockWpConfigPath ]: '<?php' } );

			await archiveSiteContent( mockSiteFolder, mockArchivePath );

			expect( mockArchiver.file ).toHaveBeenCalledWith( mockWpConfigPath, {
				name: 'wp-config.php',
				store: false,
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
