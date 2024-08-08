// To run tests, execute `npm run test -- src/lib/import-export/tests/import/validators/local-validator.test.ts`
import { LocalValidator } from '../../../import/validators/local-validator';

describe( 'LocalValidator', () => {
	const validator = new LocalValidator();

	describe( 'canHandle', () => {
		it( 'should return true for valid Local backup structure', () => {
			const fileList = [
				'app/sql/local.sql',
				'app/public/wp-content/uploads/2023/image.jpg',
				'app/public/wp-content/plugins/jetpack/jetpack.php',
				'app/public/wp-content/themes/twentytwentyone/style.css',
			];
			expect( validator.canHandle( fileList ) ).toBe( true );
		} );

		it( 'should not fail if core files exists.', () => {
			const fileList = [
				'app/sql/local.sql',
				'app/public/wp-admin/wp-admin.php',
				'app/public/wp-admin/about.php',
				'app/public/wp-includes/test.php',
				'app/public/wp-content/uploads/2023/image.jpg',
				'app/public/wp-content/plugins/jetpack/jetpack.php',
				'app/public/wp-content/themes/twentytwentyone/style.css',
			];
			expect( validator.canHandle( fileList ) ).toBe( true );
		} );

		it( 'should return false for invalid backup structure', () => {
			const fileList = [ 'random.txt', 'another-file.js' ];
			expect( validator.canHandle( fileList ) ).toBe( false );
		} );
	} );

	describe( 'parseBackupContents', () => {
		it( 'should correctly parse backup contents', () => {
			const fileList = [
				'app/sql/local.sql',
				'app/public/wp-content/uploads/2023/image.jpg',
				'app/public/wp-content/plugins/jetpack/jetpack.php',
				'app/public/wp-content/themes/twentytwentyone/style.css',
				'local-site.json',
			];
			const extractionDirectory = '/tmp/extracted';
			const result = validator.parseBackupContents( fileList, extractionDirectory );

			expect( result ).toEqual( {
				extractionDirectory,
				sqlFiles: [ '/tmp/extracted/app/sql/local.sql' ],
				wpContent: {
					uploads: [ '/tmp/extracted/app/public/wp-content/uploads/2023/image.jpg' ],
					plugins: [ '/tmp/extracted/app/public/wp-content/plugins/jetpack/jetpack.php' ],
					themes: [ '/tmp/extracted/app/public/wp-content/themes/twentytwentyone/style.css' ],
				},
				wpContentDirectory: 'app/public/wp-content',
				metaFile: '/tmp/extracted/local-site.json',
			} );
		} );

		it( 'should ignore files that not needed', () => {
			const fileList = [
				'app/sql/local.sql',
				'app/public/wp-admin/wp-admin.php',
				'app/public/wp-admin/about.php',
				'app/public/wp-includes/test.php',
				'app/public/wp-content/wp-config.php',
				'app/public/wp-content/uploads/2023/image.jpg',
				'app/public/wp-content/plugins/jetpack/jetpack.php',
				'app/public/wp-content/themes/twentytwentyone/style.css',
				'local-site.json',
			];
			const extractionDirectory = '/tmp/extracted';
			const result = validator.parseBackupContents( fileList, extractionDirectory );

			expect( result ).toEqual( {
				extractionDirectory,
				sqlFiles: [ '/tmp/extracted/app/sql/local.sql' ],
				wpContent: {
					uploads: [ '/tmp/extracted/app/public/wp-content/uploads/2023/image.jpg' ],
					plugins: [ '/tmp/extracted/app/public/wp-content/plugins/jetpack/jetpack.php' ],
					themes: [ '/tmp/extracted/app/public/wp-content/themes/twentytwentyone/style.css' ],
				},
				wpContentDirectory: 'app/public/wp-content',
				metaFile: '/tmp/extracted/local-site.json',
			} );
		} );
	} );
} );
