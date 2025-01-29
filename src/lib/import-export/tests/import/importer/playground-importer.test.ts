import * as fs from 'fs/promises';
import { lstat, move } from 'fs-extra';
import { platformTestSuite } from 'src/tests/utils/platform-test-suite';
import { SiteServer } from '../../../../../site-server';
import { PlaygroundImporter } from '../../../import/importers';
import { BackupContents } from '../../../import/types';

jest.mock( 'fs/promises' );
jest.mock( '../../../../../site-server' );
jest.mock( 'fs-extra' );

platformTestSuite( 'PlaygroundImporter', ( { normalize } ) => {
	const mockBackupContents: BackupContents = {
		extractionDirectory: normalize( '/tmp/extracted' ),
		sqlFiles: [ normalize( '/tmp/extracted/wp-content/database/.ht.sqlite' ) ],
		wpConfig: normalize( 'wp-config.php' ),
		wpContent: {
			uploads: [ normalize( '/tmp/extracted/wp-content/uploads/2023/image.jpg' ) ],
			plugins: [ normalize( '/tmp/extracted/wp-content/plugins/jetpack/jetpack.php' ) ],
			themes: [ normalize( '/tmp/extracted/wp-content/themes/twentytwentyone/style.css' ) ],
		},
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
	} );
} );
