import path from 'path';
import { describe, it, expect } from 'vitest';
import { XmlValidator } from '../xml-validator';

describe( 'XmlValidator', () => {
	const validator = new XmlValidator();

	describe( 'canHandle', () => {
		it( 'returns true for a single .xml file', () => {
			expect( validator.canHandle( [ 'export.xml' ] ) ).toBe( true );
		} );

		it( 'is case-insensitive on the extension', () => {
			expect( validator.canHandle( [ 'Export.XML' ] ) ).toBe( true );
		} );

		it( 'returns false for a single .sql file', () => {
			expect( validator.canHandle( [ 'backup.sql' ] ) ).toBe( false );
		} );

		it( 'returns false for multiple files even if one is .xml', () => {
			expect( validator.canHandle( [ 'export.xml', 'other.xml' ] ) ).toBe( false );
			expect( validator.canHandle( [ 'export.xml', 'readme.txt' ] ) ).toBe( false );
		} );

		it( 'returns false for an empty file list', () => {
			expect( validator.canHandle( [] ) ).toBe( false );
		} );
	} );

	describe( 'parseBackupContents', () => {
		it( 'records the .xml file under wxrFiles with an absolute path', () => {
			const extractionDirectory = path.join( 'tmp', 'extract' );
			const result = validator.parseBackupContents( [ 'export.xml' ], extractionDirectory );
			expect( result.wxrFiles ).toEqual( [ path.join( extractionDirectory, 'export.xml' ) ] );
			expect( result.sqlFiles ).toEqual( [] );
			expect( result.wpContentFiles ).toEqual( [] );
			expect( result.extractionDirectory ).toBe( extractionDirectory );
		} );
	} );
} );
