// To run tests, execute `npm run test -- src/lib/import-export/tests/import/importer/local-importer.test.ts`
import * as fs from 'fs/promises';
import { lstat, rename } from 'fs-extra';
import { SiteServer } from '../../../../../site-server';
import { LocalImporter } from '../../../import/importers';
import { BackupContents } from '../../../import/types';

jest.mock( 'fs/promises' );
jest.mock( '../../../../../site-server' );
jest.mock( 'fs-extra' );

describe( 'localImporter', () => {
	const mockBackupContents: BackupContents = {
		extractionDirectory: '/tmp/extracted',
		sqlFiles: [ '/tmp/extracted/app/sql/local.sql', '/tmp/extracted/app/sql/local.sql' ],
		wpContent: {
			uploads: [ '/tmp/extracted/app/public/wp-content/uploads/2023/image.jpg' ],
			plugins: [ '/tmp/extracted/app/public/wp-content/plugins/jetpack/jetpack.php' ],
			themes: [ '/tmp/extracted/app/public/wp-content/themes/twentytwentyone/style.css' ],
		},
		wpContentDirectory: 'app/public/wp-content',
		metaFile: '/tmp/extracted/local-site.json',
	};

	const mockStudioSitePath = '/path/to/studio/site';
	const mockStudioSiteId = '123';

	beforeEach( () => {
		jest.clearAllMocks();

		( SiteServer.get as jest.Mock ).mockReturnValue( {
			details: { path: '/path/to/site' },
			executeWpCliCommand: jest.fn().mockReturnValue( { stderr: null } ),
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
			expect( fs.copyFile ).toHaveBeenCalledTimes( 3 ); // One for each wp-content file
			expect( fs.readFile ).toHaveBeenCalledWith( '/tmp/extracted/local-site.json', 'utf-8' );
		} );

		it( 'should handle missing meta file', async () => {
			const importer = new LocalImporter( { ...mockBackupContents, metaFile: undefined } );
			( fs.mkdir as jest.Mock ).mockResolvedValue( undefined );
			( fs.copyFile as jest.Mock ).mockResolvedValue( undefined );

			const result = await importer.import( mockStudioSitePath, mockStudioSiteId );

			expect( result?.meta?.phpVersion ).toBe( undefined );

			expect( fs.mkdir ).toHaveBeenCalled();
			expect( fs.copyFile ).toHaveBeenCalledTimes( 3 );
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
			expect( fs.copyFile ).toHaveBeenCalledTimes( 3 );
			expect( fs.readFile ).toHaveBeenCalledWith( '/tmp/extracted/local-site.json', 'utf-8' );
		} );
	} );
} );
