// To run tests, execute `npm run test -- src/lib/import-export/tests/import/importer/local-importer.test.ts`
import * as fs from 'fs/promises';
import { lstat, move } from 'fs-extra';
import { SiteServer } from '../../../../../site-server';
import { PlaygroundImporter } from '../../../import/importers';
import { BackupContents } from '../../../import/types';

jest.mock( 'fs/promises' );
jest.mock( '../../../../../site-server' );
jest.mock( 'fs-extra' );

describe( 'localImporter', () => {
	const mockBackupContents: BackupContents = {
		extractionDirectory: '/tmp/extracted',
		sqlFiles: [ '/tmp/extracted/wp-content/database/.ht.sqlite' ],
		wpConfig: 'wp-config.php',
		wpContent: {
			uploads: [ '/tmp/extracted/wp-content/uploads/2023/image.jpg' ],
			plugins: [ '/tmp/extracted/wp-content/plugins/jetpack/jetpack.php' ],
			themes: [ '/tmp/extracted/wp-content/themes/twentytwentyone/style.css' ],
		},
		wpContentDirectory: 'wp-content',
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
					phpVersion: '7.4',
					wordpressVersion: '5.8',
				} )
			);

			await importer.import( mockStudioSitePath, mockStudioSiteId );

			expect( fs.mkdir ).toHaveBeenCalled();
			expect( fs.copyFile ).toHaveBeenCalledTimes( 4 ); // One for each wp-content file + wp-config
		} );

		it( 'should handle sqlite,copies them in the correct folder, and rename the urls', async () => {
			const importer = new PlaygroundImporter( mockBackupContents );
			await importer.import( mockStudioSitePath, mockStudioSiteId );

			const siteServer = SiteServer.get( mockStudioSiteId );

			const expectedCommand = 'option get siteurl';
			expect( siteServer?.executeWpCliCommand ).toHaveBeenNthCalledWith( 1, expectedCommand );

			expect( move ).toHaveBeenNthCalledWith(
				1,
				'/tmp/extracted/wp-content/database/.ht.sqlite',
				'/path/to/studio/site/wp-content/database/.ht.sqlite',
				{ overwrite: true }
			);
		} );
	} );
} );
