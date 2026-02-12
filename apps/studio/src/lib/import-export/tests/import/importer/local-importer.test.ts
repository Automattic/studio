import * as fs from 'fs/promises';
import { platformTestSuite } from '@studio/common/lib/tests/utils/platform-test-suite';
import { lstat, move, Stats } from 'fs-extra';
import { vi } from 'vitest';
import { LocalImporter } from 'src/lib/import-export/import/importers';
import { BackupContents } from 'src/lib/import-export/import/types';
import { SiteServer } from 'src/site-server';

vi.mock( 'fs/promises' );
vi.mock( 'src/site-server' );
vi.mock( 'fs-extra', () => ( {
	lstat: vi.fn(),
	move: vi.fn(),
} ) );

platformTestSuite( 'LocalImporter', ( { normalize } ) => {
	const mockBackupContents: BackupContents = {
		extractionDirectory: normalize( '/tmp/extracted' ),
		sqlFiles: [
			normalize( '/tmp/extracted/app/sql/local.sql' ),
			normalize( '/tmp/extracted/app/sql/local.sql' ),
		],
		wpConfig: normalize( '/tmp/extracted/app/wp-config.php' ),
		wpContentFiles: [
			normalize( '/tmp/extracted/app/public/wp-content/uploads/2023/image.jpg' ),
			normalize( '/tmp/extracted/app/public/wp-content/plugins/jetpack/jetpack.php' ),
			normalize( '/tmp/extracted/app/public/wp-content/themes/twentytwentyone/style.css' ),
			normalize( '/tmp/extracted/app/public/wp-content/fonts/open-sans.woff2' ),
		],
		wpContentDirectory: normalize( 'app/public/wp-content' ),
		metaFile: normalize( '/tmp/extracted/local-site.json' ),
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
			executeWpCliCommand: vi.fn( ( command: string ) =>
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
		it( 'should copy wp-content files and read meta file', async () => {
			const importer = new LocalImporter( mockBackupContents );
			vi.mocked( fs.mkdir ).mockResolvedValue( undefined );
			vi.mocked( fs.copyFile ).mockResolvedValue( undefined );
			vi.mocked( fs.readFile ).mockResolvedValue(
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
			expect( fs.copyFile ).toHaveBeenCalledTimes( 5 ); // One for each wp-content file + wp-config.php
			expect( fs.readFile ).toHaveBeenCalledWith(
				normalize( '/tmp/extracted/local-site.json' ),
				'utf-8'
			);
		} );

		it( 'should handle missing meta file', async () => {
			const importer = new LocalImporter( { ...mockBackupContents, metaFile: undefined } );
			vi.mocked( fs.mkdir ).mockResolvedValue( undefined );
			vi.mocked( fs.copyFile ).mockResolvedValue( undefined );

			const result = await importer.import( mockStudioSitePath, mockStudioSiteId );

			expect( result?.meta?.phpVersion ).toBe( undefined );

			expect( fs.mkdir ).toHaveBeenCalled();
			expect( fs.copyFile ).toHaveBeenCalledTimes( 5 ); // One for each wp-content file + wp-config.php
			expect( fs.readFile ).not.toHaveBeenCalled();
		} );

		it( 'should handle JSON parse error in meta file', async () => {
			const importer = new LocalImporter( mockBackupContents );
			vi.mocked( fs.mkdir ).mockResolvedValue( undefined );
			vi.mocked( fs.copyFile ).mockResolvedValue( undefined );
			vi.mocked( fs.readFile ).mockResolvedValue( 'Invalid JSON' );

			await expect(
				importer.import( mockStudioSitePath, mockStudioSiteId )
			).resolves.not.toThrow();

			expect( fs.mkdir ).toHaveBeenCalled();
			expect( fs.copyFile ).toHaveBeenCalledTimes( 5 ); // One for each wp-content file + wp-config.php
			expect( fs.readFile ).toHaveBeenCalledWith(
				normalize( '/tmp/extracted/local-site.json' ),
				'utf-8'
			);
		} );

		it( 'should properly import fonts directory', async () => {
			const importer = new LocalImporter( mockBackupContents );
			vi.mocked( fs.mkdir ).mockResolvedValue( undefined );
			vi.mocked( fs.copyFile ).mockResolvedValue( undefined );

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
				wpContentFiles: mockBackupContents.wpContentFiles.filter(
					( file ) => ! file.includes( 'fonts' )
				),
			};
			const importer = new LocalImporter( backupWithoutFonts );
			vi.mocked( fs.mkdir ).mockResolvedValue( undefined );
			vi.mocked( fs.copyFile ).mockResolvedValue( undefined );

			await importer.import( mockStudioSitePath, mockStudioSiteId );

			// Should still create other directories and copy other files
			expect( fs.mkdir ).toHaveBeenCalled();
			expect( fs.copyFile ).toHaveBeenCalledTimes( 4 ); // One for each wp-content file + wp-config.php - fonts
		} );
	} );
} );
