import { JetpackValidator } from 'src/lib/import-export/import/validators/jetpack-validator';
import { platformTestSuite } from 'src/tests/utils/platform-test-suite';

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

		it.each( [
			'sql/wp_options.sql',
			'wp-content/plugins/jetpack/jetpack.php',
			'wp-content/themes/twentytwentyone/style.css',
			'wp-content/uploads/img.jpg',
			'wp-config.php',
		] )(
			'should return true if meta.json exists and at least one of the optional files or dirs exists: %s',
			( fileOrDir ) => {
				const fileList = [ 'meta.json', fileOrDir ];
				expect( validator.canHandle( fileList ) ).toBe( true );
			}
		);
	} );

	describe( 'parseBackupContents', () => {
		it( 'should correctly parse backup contents', () => {
			const fileList = [
				'sql/wp_options.sql',
				'wp-content/fonts/open-sans.woff2',
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
				wpContentFiles: [
					normalize( '/tmp/extracted/wp-content/fonts/open-sans.woff2' ),
					normalize( '/tmp/extracted/wp-content/uploads/2023/image.jpg' ),
					normalize( '/tmp/extracted/wp-content/plugins/jetpack/jetpack.php' ),
					normalize( '/tmp/extracted/wp-content/themes/twentytwentyone/style.css' ),
					normalize( '/tmp/extracted/wp-content/mu-plugins/hello.php' ),
				],
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
				'wp-content/fonts/open-sans.woff2',
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
				wpContentFiles: [
					normalize( '/tmp/extracted/wp-content/fonts/open-sans.woff2' ),
					normalize( '/tmp/extracted/wp-content/uploads/2023/image.jpg' ),
					normalize( '/tmp/extracted/wp-content/plugins/jetpack/jetpack.php' ),
					normalize( '/tmp/extracted/wp-content/themes/twentytwentyone/style.css' ),
					normalize( '/tmp/extracted/wp-content/mu-plugins/hello.php' ),
				],
				wpContentDirectory: normalize( 'wp-content' ),
				metaFile: normalize( '/tmp/extracted/meta.json' ),
			} );
		} );
	} );
} );
