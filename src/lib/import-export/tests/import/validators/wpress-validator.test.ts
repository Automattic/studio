import path from 'path';
import { ImportEvents } from '../../../import/events';
import { WpressValidator } from '../../../import/validators/wpress-validator';

describe( 'WpressValidator', () => {
	let validator: WpressValidator;

	beforeEach( () => {
		validator = new WpressValidator();
	} );

	describe( 'canHandle', () => {
		it( 'should return true for valid wpress file structure', () => {
			const fileList = [
				'database.sql',
				'package.json',
				'uploads/image.jpg',
				'plugins/some-plugin/plugin.php',
				'themes/some-theme/style.css',
			];
			expect( validator.canHandle( fileList ) ).toBe( true );
		} );

		it( 'should return false if database.sql is missing', () => {
			const fileList = [
				'package.json',
				'uploads/image.jpg',
				'plugins/some-plugin/plugin.php',
				'themes/some-theme/style.css',
			];
			expect( validator.canHandle( fileList ) ).toBe( false );
		} );

		it( 'should return false if package.json is missing', () => {
			const fileList = [
				'database.sql',
				'uploads/image.jpg',
				'plugins/some-plugin/plugin.php',
				'themes/some-theme/style.css',
			];
			expect( validator.canHandle( fileList ) ).toBe( false );
		} );

		it( 'should return false if no optional directories are present', () => {
			const fileList = [ 'database.sql', 'package.json', 'some-other-file.txt' ];
			expect( validator.canHandle( fileList ) ).toBe( false );
		} );
	} );

	describe( 'parseBackupContents', () => {
		const extractionDirectory = '/path/to/extraction';
		const fileList = [
			'database.sql',
			'uploads/image.jpg',
			'plugins/some-plugin/plugin.php',
			'themes/some-theme/style.css',
			'package.json',
		];

		it( 'should correctly parse backup contents', () => {
			const result = validator.parseBackupContents( fileList, extractionDirectory );

			expect( result.extractionDirectory ).toBe( extractionDirectory );
			expect( result.sqlFiles ).toEqual( [ path.join( extractionDirectory, 'database.sql' ) ] );
			expect( result.wpContent.uploads ).toEqual( [
				path.join( extractionDirectory, 'uploads/image.jpg' ),
			] );
			expect( result.wpContent.plugins ).toEqual( [
				path.join( extractionDirectory, 'plugins/some-plugin/plugin.php' ),
			] );
			expect( result.wpContent.themes ).toEqual( [
				path.join( extractionDirectory, 'themes/some-theme/style.css' ),
			] );
			expect( result.metaFile ).toBe( path.join( extractionDirectory, 'package.json' ) );
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
