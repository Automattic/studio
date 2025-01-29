import { platformTestSuite } from 'src/tests/utils/platform-test-suite';
import { LocalValidator } from '../../../import/validators/local-validator';

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
				'local-site.json',
			];
			const extractionDirectory = '/tmp/extracted';
			const result = validator.parseBackupContents( fileList, extractionDirectory );

			expect( result ).toEqual( {
				extractionDirectory,
				sqlFiles: [ normalize( '/tmp/extracted/app/sql/local.sql' ) ],
				wpConfig: '',
				wpContent: {
					uploads: [ normalize( '/tmp/extracted/app/public/wp-content/uploads/2023/image.jpg' ) ],
					plugins: [
						normalize( '/tmp/extracted/app/public/wp-content/plugins/jetpack/jetpack.php' ),
					],
					themes: [
						normalize( '/tmp/extracted/app/public/wp-content/themes/twentytwentyone/style.css' ),
					],
					muPlugins: [ normalize( '/tmp/extracted/app/public/wp-content/mu-plugins/hello.php' ) ],
				},
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
				'local-site.json',
			];
			const extractionDirectory = '/tmp/extracted';
			const result = validator.parseBackupContents( fileList, extractionDirectory );

			expect( result ).toEqual( {
				extractionDirectory,
				sqlFiles: [ normalize( '/tmp/extracted/app/sql/local.sql' ) ],
				wpConfig: normalize( '/tmp/extracted/app/public/wp-config.php' ),
				wpContent: {
					uploads: [ normalize( '/tmp/extracted/app/public/wp-content/uploads/2023/image.jpg' ) ],
					plugins: [
						normalize( '/tmp/extracted/app/public/wp-content/plugins/jetpack/jetpack.php' ),
					],
					themes: [
						normalize( '/tmp/extracted/app/public/wp-content/themes/twentytwentyone/style.css' ),
					],
					muPlugins: [ normalize( '/tmp/extracted/app/public/wp-content/mu-plugins/hello.php' ) ],
				},
				wpContentDirectory: normalize( 'app/public/wp-content' ),
				metaFile: normalize( '/tmp/extracted/local-site.json' ),
			} );
		} );
	} );
} );
