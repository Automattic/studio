// To run tests, execute `npm run test -- src/lib/import-export/tests/import/validators/jetpack-validator.test.ts`
import { JetpackValidator } from '../../../import/validators/jetpack-validator';

describe( 'JetpackValidator', () => {
	const validator = new JetpackValidator();

	describe( 'canHandle', () => {
		it( 'should return true for valid Jetpack backup structure', () => {
			const fileList = [
				'sql/wp_options.sql',
				'wp-content/uploads/2023/image.jpg',
				'wp-content/plugins/jetpack/jetpack.php',
				'wp-content/themes/twentytwentyone/style.css',
			];
			expect( validator.canHandle( fileList ) ).toBe( true );
		} );

		it( 'should not fail if core files exists.', () => {
			const fileList = [
				'sql/wp_options.sql',
				'wp-admin/wp-admin.php',
				'wp-admin/about.php',
				'wp-includes/test.php',
				'wp-content/uploads/2023/image.jpg',
				'wp-content/plugins/jetpack/jetpack.php',
				'wp-content/themes/twentytwentyone/style.css',
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
				'sql/wp_options.sql',
				'wp-content/uploads/2023/image.jpg',
				'wp-content/plugins/jetpack/jetpack.php',
				'wp-content/themes/twentytwentyone/style.css',
				'studio.json',
			];
			const extractionDirectory = '/tmp/extracted';
			const result = validator.parseBackupContents( fileList, extractionDirectory );

			expect( result ).toEqual( {
				extractionDirectory,
				sqlFiles: [ '/tmp/extracted/sql/wp_options.sql' ],
				wpConfig: '',
				wpContent: {
					uploads: [ '/tmp/extracted/wp-content/uploads/2023/image.jpg' ],
					plugins: [ '/tmp/extracted/wp-content/plugins/jetpack/jetpack.php' ],
					themes: [ '/tmp/extracted/wp-content/themes/twentytwentyone/style.css' ],
				},
				wpContentDirectory: 'wp-content',
				metaFile: '/tmp/extracted/studio.json',
			} );
		} );

		it( 'should ignore files that not needed', () => {
			const fileList = [
				'sql/wp_options.sql',
				'wp-admin/wp-admin.php',
				'wp-admin/about.php',
				'wp-includes/test.php',
				'wp-config.php',
				'wp-load.php',
				'wp-admin/wp-admin.php',
				'wp-content/uploads/2023/image.jpg',
				'wp-content/plugins/jetpack/jetpack.php',
				'wp-content/themes/twentytwentyone/style.css',
				'studio.json',
			];
			const extractionDirectory = '/tmp/extracted';
			const result = validator.parseBackupContents( fileList, extractionDirectory );

			expect( result ).toEqual( {
				extractionDirectory,
				sqlFiles: [ '/tmp/extracted/sql/wp_options.sql' ],
				wpConfig: '/tmp/extracted/wp-config.php',
				wpContent: {
					uploads: [ '/tmp/extracted/wp-content/uploads/2023/image.jpg' ],
					plugins: [ '/tmp/extracted/wp-content/plugins/jetpack/jetpack.php' ],
					themes: [ '/tmp/extracted/wp-content/themes/twentytwentyone/style.css' ],
				},
				wpContentDirectory: 'wp-content',
				metaFile: '/tmp/extracted/studio.json',
			} );
		} );
	} );
} );
