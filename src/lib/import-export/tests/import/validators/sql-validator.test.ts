import path from 'path';
import { SqlValidator } from '../../../import/validators/sql-validator';

const separators = [
	{ name: 'Unix', join: path.posix.join, normalize: path.posix.normalize },
	{ name: 'Windows', join: path.win32.join, normalize: path.win32.normalize },
];

const originalJoin = path.join;
const originalNormalize = path.normalize;

describe.each( separators )( 'SqlValidator on $name', ( { join, normalize } ) => {
	let validator: SqlValidator;

	beforeEach( () => {
		validator = new SqlValidator();
		path.join = join;
		path.normalize = normalize;
	} );

	afterEach( () => {
		path.join = originalJoin;
		path.normalize = originalNormalize;
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
