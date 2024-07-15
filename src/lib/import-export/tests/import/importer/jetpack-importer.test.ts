// To run tests, execute `npm run test -- src/lib/import-export/tests/import/importer/jetpack-importer.test.ts`
import * as fs from 'fs/promises';
import { JetpackImporter } from '../../../import/importers/jetpack-importer';
import { BackupContents } from '../../../import/types';

jest.mock( 'fs/promises' );

describe( 'JetpackImporter', () => {
	const mockBackupContents: BackupContents = {
		extractionDirectory: '/tmp/extracted',
		sqlFiles: [ '/tmp/extracted/sql/wp_options.sql', '/tmp/extracted/sql/wp_posts.sql' ],
		wpContent: {
			uploads: [ '/tmp/extracted/wp-content/uploads/2023/image.jpg' ],
			plugins: [ '/tmp/extracted/wp-content/plugins/jetpack/jetpack.php' ],
			themes: [ '/tmp/extracted/wp-content/themes/twentytwentyone/style.css' ],
		},
		metaFile: '/tmp/extracted/studio.json',
	};

	const mockStudioSitePath = '/path/to/studio/site';

	beforeEach( () => {
		jest.clearAllMocks();
	} );

	describe( 'import', () => {
		it( 'should copy wp-content files and read meta file', async () => {
			const importer = new JetpackImporter( mockBackupContents );
			( fs.mkdir as jest.Mock ).mockResolvedValue( undefined );
			( fs.copyFile as jest.Mock ).mockResolvedValue( undefined );
			( fs.readFile as jest.Mock ).mockResolvedValue(
				JSON.stringify( {
					phpVersion: '7.4',
					wordpressVersion: '5.8',
				} )
			);

			await importer.import( mockStudioSitePath );

			expect( fs.mkdir ).toHaveBeenCalled();
			expect( fs.copyFile ).toHaveBeenCalledTimes( 3 ); // One for each wp-content file
			expect( fs.readFile ).toHaveBeenCalledWith( '/tmp/extracted/studio.json', 'utf-8' );
		} );

		it( 'should handle missing meta file', async () => {
			const importer = new JetpackImporter( { ...mockBackupContents, metaFile: undefined } );
			( fs.mkdir as jest.Mock ).mockResolvedValue( undefined );
			( fs.copyFile as jest.Mock ).mockResolvedValue( undefined );

			await importer.import( mockStudioSitePath );

			expect( fs.mkdir ).toHaveBeenCalled();
			expect( fs.copyFile ).toHaveBeenCalledTimes( 3 );
			expect( fs.readFile ).not.toHaveBeenCalled();
		} );

		it( 'should handle JSON parse error in meta file', async () => {
			const importer = new JetpackImporter( mockBackupContents );
			( fs.mkdir as jest.Mock ).mockResolvedValue( undefined );
			( fs.copyFile as jest.Mock ).mockResolvedValue( undefined );
			( fs.readFile as jest.Mock ).mockResolvedValue( 'Invalid JSON' );

			await expect( importer.import( mockStudioSitePath ) ).resolves.not.toThrow();

			expect( fs.mkdir ).toHaveBeenCalled();
			expect( fs.copyFile ).toHaveBeenCalledTimes( 3 );
			expect( fs.readFile ).toHaveBeenCalledWith( '/tmp/extracted/studio.json', 'utf-8' );
		} );
	} );
} );
