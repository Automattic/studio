import { vi } from 'vitest';
import { ImportEvents } from 'src/lib/import-export/import/events';
import { WpressValidator } from 'src/lib/import-export/import/validators/wpress-validator';
import { platformTestSuite } from 'src/tests/utils/platform-test-suite';

platformTestSuite( 'WpressValidator', ( { sep: separator } ) => {
	let validator: WpressValidator;

	beforeEach( () => {
		validator = new WpressValidator();
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
			expect( result.wpContentFiles ).toEqual( [
				[ extractionDirectory, 'uploads', 'image.jpg' ].join( separator ),
				[ extractionDirectory, 'plugins', 'some-plugin', 'plugin.php' ].join( separator ),
				[ extractionDirectory, 'themes', 'some-theme', 'style.css' ].join( separator ),
			] );
			expect( result.metaFile ).toBe( [ extractionDirectory, 'package.json' ].join( separator ) );
		} );

		it( 'should emit validation events', () => {
			const startSpy = vi.spyOn( validator, 'emit' );
			const completeSpy = vi.spyOn( validator, 'emit' );

			validator.parseBackupContents( fileList, extractionDirectory );

			expect( startSpy ).toHaveBeenCalledWith( ImportEvents.IMPORT_VALIDATION_START );
			expect( completeSpy ).toHaveBeenCalledWith( ImportEvents.IMPORT_VALIDATION_COMPLETE );
		} );
	} );
} );
