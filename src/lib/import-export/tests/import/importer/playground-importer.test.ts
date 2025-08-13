import * as fs from 'fs/promises';
import { lstat, move } from 'fs-extra';
import { PlaygroundImporter } from 'src/lib/import-export/import/importers';
import { BackupContents } from 'src/lib/import-export/import/types';
import { SiteServer } from 'src/site-server';
import { platformTestSuite } from 'src/tests/utils/platform-test-suite';

jest.mock( 'fs/promises' );
jest.mock( 'src/site-server' );
jest.mock( 'fs-extra' );

platformTestSuite( 'PlaygroundImporter', ( { normalize } ) => {
	const mockBackupContents: BackupContents = {
		extractionDirectory: normalize( '/tmp/extracted' ),
		sqlFiles: [ normalize( '/tmp/extracted/wp-content/database/.ht.sqlite' ) ],
		wpConfig: normalize( 'wp-config.php' ),
		wpContentFiles: [
			normalize( '/tmp/extracted/wp-content/uploads/2023/image.jpg' ),
			normalize( '/tmp/extracted/wp-content/plugins/jetpack/jetpack.php' ),
			normalize( '/tmp/extracted/wp-content/themes/twentytwentyone/style.css' ),
			normalize( '/tmp/extracted/wp-content/fonts/open-sans.woff2' ),
		],
		wpContentDirectory: normalize( 'wp-content' ),
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

		// mock rename
		( move as jest.Mock ).mockResolvedValue( null );

		jest.useFakeTimers();
		jest.setSystemTime( new Date( '2024-08-01T12:00:00Z' ) );

		( lstat as jest.Mock ).mockResolvedValue( {
			isDirectory: jest.fn().mockReturnValue( false ),
		} );
	} );

	afterEach( () => {
		jest.useRealTimers();
	} );

	describe( 'import', () => {
		it( 'should copy wp-config, wp-content files and read meta file', async () => {
			const importer = new PlaygroundImporter( mockBackupContents );
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
		} );

		it( 'should handle sqlite,copies them in the correct folder, and rename the urls', async () => {
			const importer = new PlaygroundImporter( mockBackupContents );
			await importer.import( mockStudioSitePath, mockStudioSiteId );

			const siteServer = SiteServer.get( mockStudioSiteId );

			const expectedCommand = 'option get siteurl';
			expect( siteServer?.executeWpCliCommand ).toHaveBeenNthCalledWith( 1, expectedCommand, {
				skipPluginsAndThemes: true,
			} );

			expect( move ).toHaveBeenNthCalledWith(
				1,
				normalize( '/tmp/extracted/wp-content/database/.ht.sqlite' ),
				normalize( '/path/to/studio/site/wp-content/database/.ht.sqlite' ),
				{ overwrite: true }
			);
		} );

		it( 'should properly import fonts directory', async () => {
			const importer = new PlaygroundImporter( mockBackupContents );
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
			const importer = new PlaygroundImporter( backupWithoutFonts );
			( fs.mkdir as jest.Mock ).mockResolvedValue( undefined );
			( fs.copyFile as jest.Mock ).mockResolvedValue( undefined );

			await importer.import( mockStudioSitePath, mockStudioSiteId );

			// Should still create other directories and copy other files
			expect( fs.mkdir ).toHaveBeenCalled();
			expect( fs.copyFile ).toHaveBeenCalledTimes( 4 ); // One for each wp-content file + wp-config.php - fonts
		} );
	} );
} );
