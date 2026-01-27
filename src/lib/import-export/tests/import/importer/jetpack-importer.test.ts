import * as fs from 'fs/promises';
import { lstat, move } from 'fs-extra';
import { JetpackImporter, SQLImporter } from 'src/lib/import-export/import/importers';
import { BackupContents } from 'src/lib/import-export/import/types';
import { SiteServer } from 'src/site-server';
import { platformTestSuite } from 'src/tests/utils/platform-test-suite';

jest.mock( 'fs/promises' );
jest.mock( 'src/site-server' );
jest.mock( 'fs-extra' );

platformTestSuite( 'JetpackImporter', ( { normalize } ) => {
	const mockBackupContents: BackupContents = {
		extractionDirectory: normalize( '/tmp/extracted' ),
		sqlFiles: [
			normalize( '/tmp/extracted/sql/wp_options.sql' ),
			normalize( '/tmp/extracted/sql/wp_posts.sql' ),
		],
		wpConfig: normalize( '/tmp/extracted/wp-config.php' ),
		wpContentFiles: [
			normalize( '/tmp/extracted/wp-content/uploads/2023/image.jpg' ),
			normalize( '/tmp/extracted/wp-content/plugins/jetpack/jetpack.php' ),
			normalize( '/tmp/extracted/wp-content/themes/twentytwentyone/style.css' ),
			normalize( '/tmp/extracted/wp-content/fonts/open-sans.woff2' ),
		],
		wpContentDirectory: 'wp-content',
		metaFile: normalize( '/tmp/extracted/meta.json' ),
	};

	const mockStudioSitePath = normalize( '/path/to/studio/site' );
	const mockStudioSiteId = '123';

	beforeEach( () => {
		jest.clearAllMocks();

		( SiteServer.get as jest.Mock ).mockReturnValue( {
			details: { path: '/path/to/site' },
			executeWpCliCommand: jest.fn( ( command: string ) =>
				command === 'option get siteurl' ? { stdout: 'http://localhost:8881' } : { stderr: null }
			),
		} );

		// mock move
		( move as unknown as jest.Mock ).mockResolvedValue( null );

		jest.useFakeTimers();
		jest.setSystemTime( new Date( '2024-08-01T12:00:00Z' ) );

		( lstat as unknown as jest.Mock ).mockResolvedValue( {
			isDirectory: jest.fn().mockReturnValue( false ),
		} );
	} );

	afterEach( () => {
		jest.useRealTimers();
	} );

	describe( 'import', () => {
		it( 'should copy wp-config, wp-content files and read meta file', async () => {
			const importer = new JetpackImporter( mockBackupContents );
			( fs.mkdir as jest.Mock ).mockResolvedValue( undefined );
			( fs.copyFile as jest.Mock ).mockResolvedValue( undefined );
			( fs.readFile as jest.Mock ).mockResolvedValue(
				JSON.stringify( {
					phpVersion: '8.3',
					wordpressVersion: '5.8',
				} )
			);

			await importer.import( mockStudioSitePath, mockStudioSiteId );

			expect( fs.mkdir ).toHaveBeenCalled();
			expect( fs.copyFile ).toHaveBeenCalledTimes( 5 ); // One for each wp-content file + wp-config.php
			expect( fs.readFile ).toHaveBeenCalledWith(
				normalize( '/tmp/extracted/meta.json' ),
				'utf-8'
			);
		} );

		it( 'should handle sql files and call wp sqlite import cli command', async () => {
			const importer = new SQLImporter( mockBackupContents );
			await importer.import( mockStudioSitePath, mockStudioSiteId );

			const siteServer = SiteServer.get( mockStudioSiteId );

			const expectedCommand =
				'sqlite import /wordpress/studio-backup-sql-2024-08-01-12-00-00.sql --require=/tmp/sqlite-command/command.php --enable-ast-driver';
			expect( siteServer?.executeWpCliCommand ).toHaveBeenNthCalledWith( 1, expectedCommand, {
				targetPhpVersion: '8.3',
				skipPluginsAndThemes: true,
			} );
			expect( siteServer?.executeWpCliCommand ).toHaveBeenNthCalledWith( 2, expectedCommand, {
				targetPhpVersion: '8.3',
				skipPluginsAndThemes: true,
			} );

			const expectedUnlinkPath = normalize(
				'/path/to/studio/site/studio-backup-sql-2024-08-01-12-00-00.sql'
			);
			expect( fs.rm ).toHaveBeenNthCalledWith( 1, expectedUnlinkPath, {
				force: true,
				recursive: true,
			} );
			expect( fs.rm ).toHaveBeenNthCalledWith( 2, expectedUnlinkPath, {
				force: true,
				recursive: true,
			} );
		} );

		it( 'should handle missing meta file', async () => {
			const importer = new JetpackImporter( { ...mockBackupContents, metaFile: undefined } );
			( fs.mkdir as jest.Mock ).mockResolvedValue( undefined );
			( fs.copyFile as jest.Mock ).mockResolvedValue( undefined );

			await importer.import( mockStudioSitePath, mockStudioSiteId );

			expect( fs.mkdir ).toHaveBeenCalled();
			expect( fs.copyFile ).toHaveBeenCalledTimes( 5 ); // One for each wp-content file + wp-config.php
			expect( fs.readFile ).not.toHaveBeenCalled();
		} );

		it( 'should handle JSON parse error in meta file', async () => {
			const importer = new JetpackImporter( mockBackupContents );
			( fs.mkdir as jest.Mock ).mockResolvedValue( undefined );
			( fs.copyFile as jest.Mock ).mockResolvedValue( undefined );
			( fs.readFile as jest.Mock ).mockResolvedValue( 'Invalid JSON' );

			await expect(
				importer.import( mockStudioSitePath, mockStudioSiteId )
			).resolves.not.toThrow();

			expect( fs.mkdir ).toHaveBeenCalled();
			expect( fs.copyFile ).toHaveBeenCalledTimes( 5 ); // One for each wp-content file + wp-config.php
			expect( fs.readFile ).toHaveBeenCalledWith(
				normalize( '/tmp/extracted/meta.json' ),
				'utf-8'
			);
		} );

		it( 'should properly import fonts directory', async () => {
			const importer = new JetpackImporter( mockBackupContents );
			( fs.mkdir as jest.Mock ).mockResolvedValue( undefined );
			( fs.copyFile as jest.Mock ).mockResolvedValue( undefined );

			await importer.import( mockStudioSitePath, mockStudioSiteId );

			// Verify font file was copied
			expect( fs.copyFile ).toHaveBeenCalledWith(
				normalize( '/tmp/extracted/wp-content/fonts/open-sans.woff2' ),
				normalize( '/path/to/studio/site/wp-content/fonts/open-sans.woff2' )
			);
		} );

		it( 'should handle missing fonts directory gracefully', async () => {
			const backupWithoutFonts = {
				...mockBackupContents,
				wpContentFiles: mockBackupContents.wpContentFiles.filter(
					( file ) => ! file.includes( 'fonts' )
				),
			};
			const importer = new JetpackImporter( backupWithoutFonts );
			( fs.mkdir as jest.Mock ).mockResolvedValue( undefined );
			( fs.copyFile as jest.Mock ).mockResolvedValue( undefined );

			await importer.import( mockStudioSitePath, mockStudioSiteId );

			// Should still create other directories and copy other files
			expect( fs.mkdir ).toHaveBeenCalled();
			expect( fs.copyFile ).toHaveBeenCalledTimes( 4 ); // One for each wp-content file + wp-config.php - fonts
		} );

		it( 'should categorize WordPress content files correctly', () => {
			const testFiles = [
				// Plugin files
				normalize( '/tmp/extracted/wp-content/plugins/akismet/akismet.php' ),
				normalize( '/tmp/extracted/wp-content/plugins/jetpack/jetpack.php' ),
				normalize( '/tmp/extracted/wp-content/plugins/woocommerce/woocommerce.php' ),
				// Theme files
				normalize( '/tmp/extracted/wp-content/themes/twentytwentyone/style.css' ),
				normalize( '/tmp/extracted/wp-content/themes/twentytwentythree/index.php' ),
				// Upload files
				normalize( '/tmp/extracted/wp-content/uploads/2023/01/image.jpg' ),
				normalize( '/tmp/extracted/wp-content/uploads/2024/02/document.pdf' ),
				normalize( '/tmp/extracted/wp-content/uploads/2024/03/video.mp4' ),
				// Other files
				normalize( '/tmp/extracted/wp-content/index.php' ),
				normalize( '/tmp/extracted/wp-content/fonts/open-sans.woff2' ),
				normalize( '/tmp/extracted/wp-content/mu-plugins/custom.php' ),
				// Windows path style testing
				'C:\\tmp\\extracted\\wp-content\\plugins\\hello-world\\hello.php',
				'C:\\tmp\\extracted\\wp-content\\themes\\custom\\functions.php',
				'C:\\tmp\\extracted\\wp-content\\uploads\\2024\\image.png',
				'C:\\tmp\\extracted\\wp-content\\advanced-cache.php',
			];

			const importer = new JetpackImporter( mockBackupContents );
			// Access the protected method for testing
			const categorizedFiles = (
				importer as unknown as {
					categorizeWpContentFiles: ( files: string[] ) => Record< string, string[] >;
				}
			 ).categorizeWpContentFiles( testFiles );

			expect( categorizedFiles ).toEqual( {
				plugins: [
					normalize( '/tmp/extracted/wp-content/plugins/akismet/akismet.php' ),
					normalize( '/tmp/extracted/wp-content/plugins/jetpack/jetpack.php' ),
					normalize( '/tmp/extracted/wp-content/plugins/woocommerce/woocommerce.php' ),
					'C:\\tmp\\extracted\\wp-content\\plugins\\hello-world\\hello.php',
				],
				themes: [
					normalize( '/tmp/extracted/wp-content/themes/twentytwentyone/style.css' ),
					normalize( '/tmp/extracted/wp-content/themes/twentytwentythree/index.php' ),
					'C:\\tmp\\extracted\\wp-content\\themes\\custom\\functions.php',
				],
				uploads: [
					normalize( '/tmp/extracted/wp-content/uploads/2023/01/image.jpg' ),
					normalize( '/tmp/extracted/wp-content/uploads/2024/02/document.pdf' ),
					normalize( '/tmp/extracted/wp-content/uploads/2024/03/video.mp4' ),
					'C:\\tmp\\extracted\\wp-content\\uploads\\2024\\image.png',
				],
				other: [
					normalize( '/tmp/extracted/wp-content/index.php' ),
					normalize( '/tmp/extracted/wp-content/fonts/open-sans.woff2' ),
					normalize( '/tmp/extracted/wp-content/mu-plugins/custom.php' ),
					'C:\\tmp\\extracted\\wp-content\\advanced-cache.php',
				],
			} );
		} );

		it( 'should handle empty file list for categorization', () => {
			const importer = new JetpackImporter( mockBackupContents );
			const categorizedFiles = (
				importer as unknown as {
					categorizeWpContentFiles: ( files: string[] ) => Record< string, string[] >;
				}
			 ).categorizeWpContentFiles( [] );

			expect( categorizedFiles ).toEqual( {
				plugins: [],
				themes: [],
				uploads: [],
				other: [],
			} );
		} );

		it( 'should categorize files without wp-content prefix', () => {
			const testFiles = [
				'/plugins/test-plugin/test.php',
				'/themes/test-theme/style.css',
				'/uploads/image.jpg',
				'/index.php',
			];

			const importer = new JetpackImporter( mockBackupContents );
			const categorizedFiles = (
				importer as unknown as {
					categorizeWpContentFiles: ( files: string[] ) => Record< string, string[] >;
				}
			 ).categorizeWpContentFiles( testFiles );

			expect( categorizedFiles ).toEqual( {
				plugins: [ '/plugins/test-plugin/test.php' ],
				themes: [ '/themes/test-theme/style.css' ],
				uploads: [ '/uploads/image.jpg' ],
				other: [ '/index.php' ],
			} );
		} );
	} );
} );
