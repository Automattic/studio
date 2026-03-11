import { describe, it, expect } from 'vitest';
import { processImportedSql, renameTablePrefix } from 'cli/lib/import/sql-processor';

describe( 'processImportedSql', () => {
	it( 'decodes FROM_BASE64 values to string literals', () => {
		// 'MQ==' is base64 for '1', 'c2l0ZW5hbWU=' is 'sitename'
		const input =
			"INSERT INTO `wp_options` VALUES (FROM_BASE64('MQ=='),FROM_BASE64('c2l0ZW5hbWU='));";
		const result = processImportedSql( input );
		expect( result ).toBe( "INSERT INTO `wp_options` VALUES ('1','sitename');" );
	} );

	it( 'handles CONVERT(FROM_BASE64(...) USING utf8mb4)', () => {
		// 'dGVzdA==' is base64 for 'test'
		const input = "INSERT INTO `wp_posts` VALUES (CONVERT(FROM_BASE64('dGVzdA==') USING utf8mb4));";
		const result = processImportedSql( input );
		expect( result ).toBe( "INSERT INTO `wp_posts` VALUES ('test');" );
	} );

	it( 'escapes single quotes in decoded values', () => {
		// "it's" in base64 is 'aXQncw=='
		const encoded = Buffer.from( "it's" ).toString( 'base64' );
		const input = `INSERT INTO t VALUES (FROM_BASE64('${ encoded }'));`;
		const result = processImportedSql( input );
		expect( result ).toBe( "INSERT INTO t VALUES ('it''s');" );
	} );

	it( 'preserves NULL values', () => {
		const input = "INSERT INTO t VALUES (NULL,FROM_BASE64('MQ=='));";
		const result = processImportedSql( input );
		expect( result ).toBe( "INSERT INTO t VALUES (NULL,'1');" );
	} );

	it( 'handles DROP TABLE and CREATE TABLE statements unchanged', () => {
		const input = 'DROP TABLE IF EXISTS `wp_options`;';
		const result = processImportedSql( input );
		expect( result ).toBe( input );
	} );

	it( 'handles multi-line SQL with mixed statements', () => {
		const input = [
			'DROP TABLE IF EXISTS `wp_options`;',
			'CREATE TABLE `wp_options` (option_id INT, option_name VARCHAR(255));',
			"INSERT INTO `wp_options` VALUES (FROM_BASE64('MQ=='),FROM_BASE64('dGVzdA=='));",
		].join( '\n' );

		const result = processImportedSql( input );
		expect( result ).toContain( "VALUES ('1','test')" );
		expect( result ).toContain( 'DROP TABLE IF EXISTS' );
		expect( result ).toContain( 'CREATE TABLE' );
	} );

	it( 'handles binary data with hex literals', () => {
		// Create a buffer with invalid UTF-8 bytes
		const binaryData = Buffer.from( [ 0xff, 0xfe, 0x00, 0x01 ] );
		const encoded = binaryData.toString( 'base64' );
		const input = `INSERT INTO t VALUES (FROM_BASE64('${ encoded }'));`;
		const result = processImportedSql( input );
		expect( result ).toBe( "INSERT INTO t VALUES (X'fffe0001');" );
	} );
} );

describe( 'renameTablePrefix', () => {
	it( 'renames table prefix in backtick-quoted identifiers', () => {
		const input = 'DROP TABLE IF EXISTS `wp123_options`;';
		const result = renameTablePrefix( input, 'wp123_', 'wp_' );
		expect( result ).toBe( 'DROP TABLE IF EXISTS `wp_options`;' );
	} );

	it( 'renames prefix in INSERT statements', () => {
		const input = "INSERT INTO `custom_posts` VALUES ('1','hello');";
		const result = renameTablePrefix( input, 'custom_', 'wp_' );
		expect( result ).toBe( "INSERT INTO `wp_posts` VALUES ('1','hello');" );
	} );

	it( 'does nothing when prefixes match', () => {
		const input = "INSERT INTO `wp_options` VALUES ('1');";
		const result = renameTablePrefix( input, 'wp_', 'wp_' );
		expect( result ).toBe( input );
	} );

	it( 'does not modify unquoted text containing the prefix', () => {
		// The prefix only appears in a string value, not a backtick-quoted identifier
		const input = "INSERT INTO `wp_options` VALUES ('wp123_something');";
		const result = renameTablePrefix( input, 'wp123_', 'wp_' );
		// Only the table name should change, not the value
		expect( result ).toBe( "INSERT INTO `wp_options` VALUES ('wp123_something');" );
	} );
} );
