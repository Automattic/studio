import path from 'path';
import { LocalValidator } from '../../../import/validators/local-validator';

const separators = [
	{ name: 'Unix', join: path.posix.join, normalize: path.posix.normalize },
	{ name: 'Windows', join: path.win32.join, normalize: path.win32.normalize },
];

const originalJoin = path.join;
const originalNormalize = path.normalize;

describe.each( separators )( 'LocalValidator on $name', ( { join, normalize } ) => {
	let validator: LocalValidator;

	beforeEach( () => {
		validator = new LocalValidator();
		path.join = join;
		path.normalize = normalize;
	} );

	afterEach( () => {
		path.join = originalJoin;
		path.normalize = originalNormalize;
	} );

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
				},
				wpContentDirectory: normalize( 'app/public/wp-content' ),
				metaFile: normalize( '/tmp/extracted/local-site.json' ),
			} );
		} );
	} );
} );
