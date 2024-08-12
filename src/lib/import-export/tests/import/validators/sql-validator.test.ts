// To run tests, execute `npm run test -- src/lib/import-export/tests/import/validators/sql-validator.test.ts`
import { SqlValidator } from '../../../import/validators/sql-validator';

describe( 'SqlValidator', () => {
	const validator = new SqlValidator();

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
				sqlFiles: [ '/tmp/extracted/backup.sql' ],
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
