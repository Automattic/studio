import { LocalValidator } from 'src/lib/import-export/import/validators/local-validator';
import { platformTestSuite } from 'src/tests/utils/platform-test-suite';

platformTestSuite( 'LocalValidator', ( { normalize } ) => {
	let validator: LocalValidator;

	beforeEach( () => {
		validator = new LocalValidator();
	} );

	describe( 'canHandle', () => {
		it( 'should return true for valid Local backup structure', () => {
			const fileList = [
				'app/sql/local.sql',
				'app/public/wp-content/uploads/2023/image.jpg',
				'app/public/wp-content/plugins/jetpack/jetpack.php',
				'app/public/wp-content/themes/twentytwentyone/style.css',
				'app/public/wp-content/mu-plugins/hello.php',
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
				'app/public/wp-content/mu-plugins/hello.php',
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
				'app/public/wp-content/mu-plugins/hello.php',
				'app/public/wp-content/fonts/open-sans.woff2',
				'local-site.json',
			];
			const extractionDirectory = '/tmp/extracted';
			const result = validator.parseBackupContents( fileList, extractionDirectory );

			expect( result ).toEqual( {
				extractionDirectory,
				sqlFiles: [ normalize( '/tmp/extracted/app/sql/local.sql' ) ],
				wpConfig: '',
				wpContentFiles: [
					normalize( '/tmp/extracted/app/public/wp-content/uploads/2023/image.jpg' ),
					normalize( '/tmp/extracted/app/public/wp-content/plugins/jetpack/jetpack.php' ),
					normalize( '/tmp/extracted/app/public/wp-content/themes/twentytwentyone/style.css' ),
					normalize( '/tmp/extracted/app/public/wp-content/mu-plugins/hello.php' ),
					normalize( '/tmp/extracted/app/public/wp-content/fonts/open-sans.woff2' ),
				],
				wpContentDirectory: normalize( 'app/public/wp-content' ),
				metaFile: normalize( '/tmp/extracted/local-site.json' ),
			} );
		} );

		it( 'should ignore files that not needed', () => {
			const fileList = [
				'app/sql/local.sql',
				'app/public/wp-admin/wp-admin.php',
				'app/public/wp-admin/about.php',
				'app/public/wp-includes/test.php',
				'app/public/wp-config.php',
				'app/public/wp-content/uploads/2023/image.jpg',
				'app/public/wp-content/plugins/jetpack/jetpack.php',
				'app/public/wp-content/themes/twentytwentyone/style.css',
				'app/public/wp-content/mu-plugins/hello.php',
				'app/public/wp-content/fonts/open-sans.woff2',
				'local-site.json',
			];
			const extractionDirectory = '/tmp/extracted';
			const result = validator.parseBackupContents( fileList, extractionDirectory );

			expect( result ).toEqual( {
				extractionDirectory,
				sqlFiles: [ normalize( '/tmp/extracted/app/sql/local.sql' ) ],
				wpConfig: normalize( '/tmp/extracted/app/public/wp-config.php' ),
				wpContentFiles: [
					normalize( '/tmp/extracted/app/public/wp-content/uploads/2023/image.jpg' ),
					normalize( '/tmp/extracted/app/public/wp-content/plugins/jetpack/jetpack.php' ),
					normalize( '/tmp/extracted/app/public/wp-content/themes/twentytwentyone/style.css' ),
					normalize( '/tmp/extracted/app/public/wp-content/mu-plugins/hello.php' ),
					normalize( '/tmp/extracted/app/public/wp-content/fonts/open-sans.woff2' ),
				],
				wpContentDirectory: normalize( 'app/public/wp-content' ),
				metaFile: normalize( '/tmp/extracted/local-site.json' ),
			} );
		} );
	} );
} );
