import fs from 'fs';
import { platformTestSuite } from '@studio/common/lib/tests/utils/platform-test-suite';
import { lstat, move, Stats } from 'fs-extra';
import { vi } from 'vitest';
import { PlaygroundImporter } from 'src/lib/import-export/import/importers';
import { BackupContents } from 'src/lib/import-export/import/types';
import { SiteServer } from 'src/site-server';

vi.mock( 'fs' );
vi.mock( 'src/site-server' );
vi.mock( 'fs-extra', () => ( {
	lstat: vi.fn(),
	move: vi.fn(),
} ) );

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
		vi.clearAllMocks();

		vi.mocked( SiteServer.get, { partial: true } ).mockReturnValue( {
			details: {
				path: '/path/to/site',
				id: 'test-id',
				name: 'Test Site',
				port: 8881,
				phpVersion: '8.0',
				running: false,
			},
			executeWpCliCommand: vi
				.fn()
				.mockImplementation( ( command: string ) =>
					Promise.resolve(
						command === 'option get siteurl'
							? { stdout: 'http://localhost:8881', stderr: '', exitCode: 0 }
							: { stdout: '', stderr: '', exitCode: 0 }
					)
				),
		} );

		// mock move
		vi.mocked( move ).mockResolvedValue();

		vi.useFakeTimers();
		vi.setSystemTime( new Date( '2024-08-01T12:00:00Z' ) );

		vi.mocked( lstat ).mockImplementation(
			async () =>
				( {
					isDirectory: () => false,
				} ) as Stats
		);
	} );

	afterEach( () => {} );

	describe( 'import', () => {
		it( 'should copy wp-config, wp-content files and read meta file', async () => {
			const importer = new PlaygroundImporter( mockBackupContents );
			vi.mocked( fs.promises.mkdir ).mockResolvedValue( undefined );
			vi.mocked( fs.promises.copyFile ).mockResolvedValue( undefined );
			vi.mocked( fs.promises.readFile ).mockResolvedValue(
				JSON.stringify( {
					phpVersion: '8.3',
					wordpressVersion: '5.8',
				} )
			);

			await importer.import( mockStudioSitePath, mockStudioSiteId );

			expect( fs.promises.mkdir ).toHaveBeenCalled();
			expect( fs.promises.copyFile ).toHaveBeenCalledTimes( 5 ); // One for each wp-content file + wp-config.php
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
			vi.mocked( fs.promises.mkdir ).mockResolvedValue( undefined );
			vi.mocked( fs.promises.copyFile ).mockResolvedValue( undefined );

			await importer.import( mockStudioSitePath, mockStudioSiteId );

			// Verify font file was copied
			expect( fs.promises.copyFile ).toHaveBeenCalledWith(
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
			vi.mocked( fs.promises.mkdir ).mockResolvedValue( undefined );
			vi.mocked( fs.promises.copyFile ).mockResolvedValue( undefined );

			await importer.import( mockStudioSitePath, mockStudioSiteId );

			// Should still create other directories and copy other files
			expect( fs.promises.mkdir ).toHaveBeenCalled();
			expect( fs.promises.copyFile ).toHaveBeenCalledTimes( 4 ); // One for each wp-content file + wp-config.php - fonts
		} );
	} );
} );
