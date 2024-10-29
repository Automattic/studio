// To run tests, execute `npm run test -- src/lib/import-export/tests/import/importer/default-importer.test.ts`
import * as fs from 'fs/promises';
import { lstat, move } from 'fs-extra';
import { SiteServer } from '../../../../../site-server';
import { JetpackImporter, SQLImporter } from '../../../import/importers';
import { BackupContents } from '../../../import/types';

jest.mock( 'fs/promises' );
jest.mock( '../../../../../site-server' );
jest.mock( 'fs-extra' );

describe( 'JetpackImporter', () => {
	const mockBackupContents: BackupContents = {
		extractionDirectory: '/tmp/extracted',
		sqlFiles: [ '/tmp/extracted/sql/wp_options.sql', '/tmp/extracted/sql/wp_posts.sql' ],
		wpConfig: '/tmp/extraced/wp-config.php',
		wpContent: {
			uploads: [ '/tmp/extracted/wp-content/uploads/2023/image.jpg' ],
			plugins: [ '/tmp/extracted/wp-content/plugins/jetpack/jetpack.php' ],
			themes: [ '/tmp/extracted/wp-content/themes/twentytwentyone/style.css' ],
		},
		wpContentDirectory: 'wp-content',
		metaFile: '/tmp/extracted/meta.json',
	};

	const mockStudioSitePath = '/path/to/studio/site';
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
			const importer = new JetpackImporter( mockBackupContents );
			( fs.mkdir as jest.Mock ).mockResolvedValue( undefined );
			( fs.copyFile as jest.Mock ).mockResolvedValue( undefined );
			( fs.readFile as jest.Mock ).mockResolvedValue(
				JSON.stringify( {
					phpVersion: '7.4',
					wordpressVersion: '5.8',
				} )
			);

			await importer.import( mockStudioSitePath, mockStudioSiteId );

			expect( fs.mkdir ).toHaveBeenCalled();
			expect( fs.copyFile ).toHaveBeenCalledTimes( 4 ); // One for each wp-content file + wp-config
			expect( fs.readFile ).toHaveBeenCalledWith( '/tmp/extracted/meta.json', 'utf-8' );
		} );

		it( 'should handle sql files and call wp sqlite import cli command', async () => {
			const importer = new SQLImporter( mockBackupContents );
			await importer.import( mockStudioSitePath, mockStudioSiteId );

			const siteServer = SiteServer.get( mockStudioSiteId );

			const expectedCommand =
				'sqlite import studio-backup-sql-2024-08-01-12-00-00.sql --require=/tmp/sqlite-command/command.php';
			expect( siteServer?.executeWpCliCommand ).toHaveBeenNthCalledWith( 1, expectedCommand, {
				targetPhpVersion: '8.1',
			} );
			expect( siteServer?.executeWpCliCommand ).toHaveBeenNthCalledWith( 2, expectedCommand, {
				targetPhpVersion: '8.1',
			} );

			const expectedUnlinkPath = '/path/to/studio/site/studio-backup-sql-2024-08-01-12-00-00.sql';
			expect( fs.unlink ).toHaveBeenNthCalledWith( 1, expectedUnlinkPath );
			expect( fs.unlink ).toHaveBeenNthCalledWith( 2, expectedUnlinkPath );
		} );

		it( 'should handle missing meta file', async () => {
			const importer = new JetpackImporter( { ...mockBackupContents, metaFile: undefined } );
			( fs.mkdir as jest.Mock ).mockResolvedValue( undefined );
			( fs.copyFile as jest.Mock ).mockResolvedValue( undefined );

			await importer.import( mockStudioSitePath, mockStudioSiteId );

			expect( fs.mkdir ).toHaveBeenCalled();
			expect( fs.copyFile ).toHaveBeenCalledTimes( 4 );
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
			expect( fs.copyFile ).toHaveBeenCalledTimes( 4 );
			expect( fs.readFile ).toHaveBeenCalledWith( '/tmp/extracted/meta.json', 'utf-8' );
		} );

		it( 'should regenerate media after import', async () => {
			const importer = new JetpackImporter( mockBackupContents );
			await importer.import( mockStudioSitePath, mockStudioSiteId );

			const siteServer = SiteServer.get( mockStudioSiteId );
			expect( siteServer?.executeWpCliCommand ).toHaveBeenCalledWith( 'media regenerate --yes' );
		} );
	} );
} );
