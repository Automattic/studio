import { platformTestSuite } from 'src/tests/utils/platform-test-suite';
import { PlaygroundValidator } from '../../../import/validators/playground-validator';

platformTestSuite( 'PlaygroundValidator', ( { normalize } ) => {
	const validator = new PlaygroundValidator();

	describe( 'canHandle', () => {
		it( 'should return true for valid Playground backup structure', () => {
			const fileList = [
				'wp-content/database/.ht.sqlite',
				'wp-content/uploads/2023/image.jpg',
				'wp-content/plugins/jetpack/jetpack.php',
				'wp-content/themes/twentytwentyone/style.css',
			];
			expect( validator.canHandle( fileList ) ).toBe( true );
		} );

		it( 'should not fail if core files exists.', () => {
			const fileList = [
				'wp-content/database/.ht.sqlite',
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
			const fileList = [
				'wp-admin/wp-admin.php',
				'wp-admin/about.php',
				'wp-includes/test.php',
				'wp-content/uploads/2023/image.jpg',
				'wp-content/plugins/jetpack/jetpack.php',
				'wp-content/themes/twentytwentyone/style.css',
				'random.txt',
				'another-file.js',
			];
			expect( validator.canHandle( fileList ) ).toBe( false );
		} );
	} );

	describe( 'parseBackupContents', () => {
		it( 'should correctly parse backup contents', () => {
			const fileList = [
				'wp-content/database/.ht.sqlite',
				'wp-content/uploads/2023/image.jpg',
				'wp-content/plugins/jetpack/jetpack.php',
				'wp-content/themes/twentytwentyone/style.css',
			];
			const extractionDirectory = normalize( '/tmp/extracted' );
			const result = validator.parseBackupContents( fileList, extractionDirectory );

			expect( result ).toEqual( {
				extractionDirectory,
				sqlFiles: [ normalize( '/tmp/extracted/wp-content/database/.ht.sqlite' ) ],
				wpConfig: '',
				wpContent: {
					uploads: [ normalize( '/tmp/extracted/wp-content/uploads/2023/image.jpg' ) ],
					plugins: [ normalize( '/tmp/extracted/wp-content/plugins/jetpack/jetpack.php' ) ],
					themes: [ normalize( '/tmp/extracted/wp-content/themes/twentytwentyone/style.css' ) ],
				},
				wpContentDirectory: 'wp-content',
			} );
		} );

		it( 'should ignore files that not needed', () => {
			const fileList = [
				'wp-content/database/.ht.sqlite',
				'wp-admin/wp-admin.php',
				'wp-admin/about.php',
				'wp-includes/test.php',
				'wp-config.php',
				'wp-content/uploads/2023/image.jpg',
				'wp-content/plugins/jetpack/jetpack.php',
				'wp-content/themes/twentytwentyone/style.css',
			];
			const extractionDirectory = normalize( '/tmp/extracted' );
			const result = validator.parseBackupContents( fileList, extractionDirectory );

			expect( result ).toEqual( {
				extractionDirectory,
				sqlFiles: [ normalize( '/tmp/extracted/wp-content/database/.ht.sqlite' ) ],
				wpConfig: normalize( '/tmp/extracted/wp-config.php' ),
				wpContent: {
					uploads: [ normalize( '/tmp/extracted/wp-content/uploads/2023/image.jpg' ) ],
					plugins: [ normalize( '/tmp/extracted/wp-content/plugins/jetpack/jetpack.php' ) ],
					themes: [ normalize( '/tmp/extracted/wp-content/themes/twentytwentyone/style.css' ) ],
				},
				wpContentDirectory: 'wp-content',
			} );
		} );
	} );
} );
