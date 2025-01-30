import { platformTestSuite } from 'src/tests/utils/platform-test-suite';
import { JetpackValidator } from '../../../import/validators/jetpack-validator';

platformTestSuite( 'JetpackValidator', ( { normalize } ) => {
	let validator: JetpackValidator;

	beforeEach( () => {
		validator = new JetpackValidator();
	} );

	describe( 'canHandle', () => {
		it( 'should return true for valid Jetpack backup structure', () => {
			const fileList = [
				'sql/wp_options.sql',
				'wp-content/uploads/2023/image.jpg',
				'wp-content/plugins/jetpack/jetpack.php',
				'wp-content/themes/twentytwentyone/style.css',
				'wp-content/mu-plugins/hello.php',
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
				'wp-content/mu-plugins/hello.php',
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
				'wp-content/mu-plugins/hello.php',
				'meta.json',
			];
			const extractionDirectory = '/tmp/extracted';
			const result = validator.parseBackupContents( fileList, extractionDirectory );

			expect( result ).toEqual( {
				extractionDirectory,
				sqlFiles: [ normalize( '/tmp/extracted/sql/wp_options.sql' ) ],
				wpConfig: '',
				wpContent: {
					uploads: [ normalize( '/tmp/extracted/wp-content/uploads/2023/image.jpg' ) ],
					plugins: [ normalize( '/tmp/extracted/wp-content/plugins/jetpack/jetpack.php' ) ],
					themes: [ normalize( '/tmp/extracted/wp-content/themes/twentytwentyone/style.css' ) ],
					muPlugins: [ normalize( '/tmp/extracted/wp-content/mu-plugins/hello.php' ) ],
				},
				wpContentDirectory: normalize( 'wp-content' ),
				metaFile: normalize( '/tmp/extracted/meta.json' ),
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
				'wp-content/mu-plugins/hello.php',
				'meta.json',
			];
			const extractionDirectory = '/tmp/extracted';
			const result = validator.parseBackupContents( fileList, extractionDirectory );

			expect( result ).toEqual( {
				extractionDirectory,
				sqlFiles: [ normalize( '/tmp/extracted/sql/wp_options.sql' ) ],
				wpConfig: normalize( '/tmp/extracted/wp-config.php' ),
				wpContent: {
					uploads: [ normalize( '/tmp/extracted/wp-content/uploads/2023/image.jpg' ) ],
					plugins: [ normalize( '/tmp/extracted/wp-content/plugins/jetpack/jetpack.php' ) ],
					themes: [ normalize( '/tmp/extracted/wp-content/themes/twentytwentyone/style.css' ) ],
					muPlugins: [ normalize( '/tmp/extracted/wp-content/mu-plugins/hello.php' ) ],
				},
				wpContentDirectory: normalize( 'wp-content' ),
				metaFile: normalize( '/tmp/extracted/meta.json' ),
			} );
		} );
	} );
} );
