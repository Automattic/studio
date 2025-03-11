import * as fs from 'fs/promises';
import { lstat, rename } from 'fs-extra';
import { LocalImporter } from 'src/lib/import-export/import/importers';
import { BackupContents } from 'src/lib/import-export/import/types';
import { SiteServer } from 'src/site-server';
import { platformTestSuite } from 'src/tests/utils/platform-test-suite';

jest.mock( 'fs/promises' );
jest.mock( 'src/site-server' );
jest.mock( 'fs-extra' );

platformTestSuite( 'LocalImporter', ( { normalize } ) => {
	const mockBackupContents: BackupContents = {
		extractionDirectory: normalize( '/tmp/extracted' ),
		sqlFiles: [
			normalize( '/tmp/extracted/app/sql/local.sql' ),
			normalize( '/tmp/extracted/app/sql/local.sql' ),
		],
		wpConfig: normalize( '/tmp/extracted/app/wp-config.php' ),
		wpContent: {
			uploads: [ normalize( '/tmp/extracted/app/public/wp-content/uploads/2023/image.jpg' ) ],
			plugins: [ normalize( '/tmp/extracted/app/public/wp-content/plugins/jetpack/jetpack.php' ) ],
			themes: [
				normalize( '/tmp/extracted/app/public/wp-content/themes/twentytwentyone/style.css' ),
			],
			fonts: [ normalize( '/tmp/extracted/app/public/wp-content/fonts/open-sans.woff2' ) ],
		},
		wpContentDirectory: normalize( 'app/public/wp-content' ),
		metaFile: normalize( '/tmp/extracted/local-site.json' ),
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
		( rename as jest.Mock ).mockResolvedValue( null );

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
		it( 'should copy wp-content files and read meta file', async () => {
			const importer = new LocalImporter( mockBackupContents );
			( fs.mkdir as jest.Mock ).mockResolvedValue( undefined );
			( fs.copyFile as jest.Mock ).mockResolvedValue( undefined );
			( fs.readFile as jest.Mock ).mockResolvedValue(
				JSON.stringify( {
					services: {
						php: {
							version: '8.2.23',
						},
					},
				} )
			);

			const result = await importer.import( mockStudioSitePath, mockStudioSiteId );

			expect( result?.meta?.phpVersion ).toBe( '8.2' );

			expect( fs.mkdir ).toHaveBeenCalled();
			expect( fs.copyFile ).toHaveBeenCalledTimes( 5 ); // One for each wp-content file (including fonts) + wp-config
			expect( fs.readFile ).toHaveBeenCalledWith(
				normalize( '/tmp/extracted/local-site.json' ),
				'utf-8'
			);
		} );

		it( 'should handle missing meta file', async () => {
			const importer = new LocalImporter( { ...mockBackupContents, metaFile: undefined } );
			( fs.mkdir as jest.Mock ).mockResolvedValue( undefined );
			( fs.copyFile as jest.Mock ).mockResolvedValue( undefined );

			const result = await importer.import( mockStudioSitePath, mockStudioSiteId );

			expect( result?.meta?.phpVersion ).toBe( undefined );

			expect( fs.mkdir ).toHaveBeenCalled();
			expect( fs.copyFile ).toHaveBeenCalledTimes( 5 );
			expect( fs.readFile ).not.toHaveBeenCalled();
		} );

		it( 'should handle JSON parse error in meta file', async () => {
			const importer = new LocalImporter( mockBackupContents );
			( fs.mkdir as jest.Mock ).mockResolvedValue( undefined );
			( fs.copyFile as jest.Mock ).mockResolvedValue( undefined );
			( fs.readFile as jest.Mock ).mockResolvedValue( 'Invalid JSON' );

			await expect(
				importer.import( mockStudioSitePath, mockStudioSiteId )
			).resolves.not.toThrow();

			expect( fs.mkdir ).toHaveBeenCalled();
			expect( fs.copyFile ).toHaveBeenCalledTimes( 5 );
			expect( fs.readFile ).toHaveBeenCalledWith(
				normalize( '/tmp/extracted/local-site.json' ),
				'utf-8'
			);
		} );

		it( 'should properly import fonts directory', async () => {
			const importer = new LocalImporter( mockBackupContents );
			( fs.mkdir as jest.Mock ).mockResolvedValue( undefined );
			( fs.copyFile as jest.Mock ).mockResolvedValue( undefined );

			await importer.import( mockStudioSitePath, mockStudioSiteId );

			// Verify font file was copied
			expect( fs.copyFile ).toHaveBeenCalledWith(
				normalize( '/tmp/extracted/app/public/wp-content/fonts/open-sans.woff2' ),
				normalize( '/path/to/studio/site/wp-content/fonts/open-sans.woff2' )
			);
		} );

		it( 'should handle missing fonts directory gracefully', async () => {
			const backupWithoutFonts = {
				...mockBackupContents,
				wpContent: {
					...mockBackupContents.wpContent,
					fonts: [],
				},
			};
			const importer = new LocalImporter( backupWithoutFonts );
			( fs.mkdir as jest.Mock ).mockResolvedValue( undefined );
			( fs.copyFile as jest.Mock ).mockResolvedValue( undefined );

			await importer.import( mockStudioSitePath, mockStudioSiteId );

			// Should still create other directories and copy other files
			expect( fs.mkdir ).toHaveBeenCalled();
			expect( fs.copyFile ).toHaveBeenCalledTimes( 4 ); // One less than with fonts
		} );
	} );
} );
