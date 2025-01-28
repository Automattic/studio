import { platformTestSuite } from 'src/tests/utils/platform-test-suite';
import { SqlValidator } from '../../../import/validators/sql-validator';

platformTestSuite( 'SqlValidator', ( { normalize } ) => {
	let validator: SqlValidator;

	beforeEach( () => {
		validator = new SqlValidator();
	} );

	describe( 'canHandle', () => {
		it( 'should return true for a single SQL file', () => {
			const fileList = [ 'backup.sql' ];
			expect( validator.canHandle( fileList ) ).toBe( true );
		} );

		it( 'should return false for multiple files', () => {
			const fileList = [ 'backup.sql', 'another_file.txt' ];
			expect( validator.canHandle( fileList ) ).toBe( false );
		} );

		it( 'should return false for a single non-SQL file', () => {
			const fileList = [ 'backup.txt' ];
			expect( validator.canHandle( fileList ) ).toBe( false );
		} );

		it( 'should return false for an empty file list', () => {
			const fileList: string[] = [];
			expect( validator.canHandle( fileList ) ).toBe( false );
		} );
	} );

	describe( 'parseBackupContents', () => {
		it( 'should correctly parse backup contents for a single SQL file', () => {
			const fileList = [ 'backup.sql' ];
			const extractionDirectory = '/tmp/extracted';
			const result = validator.parseBackupContents( fileList, extractionDirectory );

			expect( result ).toEqual( {
				extractionDirectory,
				sqlFiles: [ normalize( '/tmp/extracted/backup.sql' ) ],
				wpConfig: '',
				wpContent: {
					uploads: [],
					plugins: [],
					themes: [],
				},
				wpContentDirectory: '',
			} );
		} );
	} );
} );
