import path from 'path';
import { ImportEvents } from '../../../import/events';
import { WpressValidator } from '../../../import/validators/wpress-validator';

const platforms = [
	{ name: 'Unix', separator: path.posix.sep, join: path.posix.join },
	{ name: 'Windows', separator: path.win32.sep, join: path.win32.join },
];

const originalSep = path.sep;
const originalJoin = path.join;

describe.each( platforms )( 'WpressValidator on $name', ( { separator, join } ) => {
	let validator: WpressValidator;

	beforeEach( () => {
		validator = new WpressValidator();
		// @ts-expect-error - Temporarily override path.sep
		path.sep = separator;
		path.join = join;
	} );

	afterEach( () => {
		// @ts-expect-error - Restore original path.sep
		path.sep = originalSep;
		path.join = originalJoin;
	} );

	describe( 'canHandle', () => {
		it( 'should return true for valid wpress file structure', () => {
			const fileList = [
				'database.sql',
				'package.json',
				[ 'uploads', 'image.jpg' ].join( separator ),
				[ 'plugins', 'some-plugin', 'plugin.php' ].join( separator ),
				[ 'themes', 'some-theme', 'style.css' ].join( separator ),
			];
			expect( validator.canHandle( fileList ) ).toBe( true );
		} );

		it( 'should return false if database.sql is missing', () => {
			const fileList = [
				'package.json',
				[ 'uploads', 'image.jpg' ].join( separator ),
				[ 'plugins', 'some-plugin', 'plugin.php' ].join( separator ),
				[ 'themes', 'some-theme', 'style.css' ].join( separator ),
			];
			expect( validator.canHandle( fileList ) ).toBe( false );
		} );

		it( 'should return false if package.json is missing', () => {
			const fileList = [
				'database.sql',
				[ 'uploads', 'image.jpg' ].join( separator ),
				[ 'plugins', 'some-plugin', 'plugin.php' ].join( separator ),
				[ 'themes', 'some-theme', 'style.css' ].join( separator ),
			];
			expect( validator.canHandle( fileList ) ).toBe( false );
		} );

		it( 'should return false if no optional directories are present', () => {
			const fileList = [ 'database.sql', 'package.json', 'some-other-file.txt' ];
			expect( validator.canHandle( fileList ) ).toBe( false );
		} );
	} );

	describe( 'parseBackupContents', () => {
		beforeEach( () => {
			validator = new WpressValidator();
			// @ts-expect-error - Temporarily override path.sep
			path.sep = separator;
			path.join = jest.fn( ( ...segments ) => segments.join( separator ) );
		} );

		const extractionDirectory = [ 'path', 'to', 'extraction' ].join( separator );
		const fileList = [
			'database.sql',
			[ 'uploads', 'image.jpg' ].join( separator ),
			[ 'plugins', 'some-plugin', 'plugin.php' ].join( separator ),
			[ 'themes', 'some-theme', 'style.css' ].join( separator ),
			'package.json',
		];

		it( 'should correctly parse backup contents', () => {
			const result = validator.parseBackupContents( fileList, extractionDirectory );

			expect( result.extractionDirectory ).toBe( extractionDirectory );
			expect( result.sqlFiles ).toEqual( [
				[ extractionDirectory, 'database.sql' ].join( separator ),
			] );
			expect( result.wpContent.uploads ).toEqual( [
				[ extractionDirectory, 'uploads', 'image.jpg' ].join( separator ),
			] );
			expect( result.wpContent.plugins ).toEqual( [
				[ extractionDirectory, 'plugins', 'some-plugin', 'plugin.php' ].join( separator ),
			] );
			expect( result.wpContent.themes ).toEqual( [
				[ extractionDirectory, 'themes', 'some-theme', 'style.css' ].join( separator ),
			] );
			expect( result.metaFile ).toBe( [ extractionDirectory, 'package.json' ].join( separator ) );
		} );

		it( 'should emit validation events', () => {
			const startSpy = jest.spyOn( validator, 'emit' );
			const completeSpy = jest.spyOn( validator, 'emit' );

			validator.parseBackupContents( fileList, extractionDirectory );

			expect( startSpy ).toHaveBeenCalledWith( ImportEvents.IMPORT_VALIDATION_START );
			expect( completeSpy ).toHaveBeenCalledWith( ImportEvents.IMPORT_VALIDATION_COMPLETE );
		} );
	} );
} );
