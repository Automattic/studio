import path from 'path';
import { JetpackValidator } from '../../../import/validators/jetpack-validator';

const separators = [
	{ name: 'Unix', join: path.posix.join, normalize: path.posix.normalize },
	{ name: 'Windows', join: path.win32.join, normalize: path.win32.normalize },
];

const originalJoin = path.join;
const originalNormalize = path.normalize;

describe.each( separators )( 'JetpackValidator on $name', ( { join, normalize } ) => {
	let validator: JetpackValidator;

	beforeEach( () => {
		validator = new JetpackValidator();
		path.join = join;
		path.normalize = normalize;
	} );

	afterEach( () => {
		path.join = originalJoin;
		path.normalize = originalNormalize;
	} );

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
				},
				wpContentDirectory: normalize( 'wp-content' ),
				metaFile: normalize( '/tmp/extracted/meta.json' ),
			} );
		} );
	} );
} );
