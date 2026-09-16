import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BackupContents } from '../../types';
import { ensureDir, rewriteEmptyHexLiterals, WpressImporter } from '../importer';

describe( 'ensureDir', () => {
	let tmpDir: string;

	beforeEach( () => {
		tmpDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-ensure-dir-' ) );
	} );

	afterEach( () => {
		fs.rmSync( tmpDir, { recursive: true, force: true } );
	} );

	it( 'creates a directory that does not exist', async () => {
		const target = path.join( tmpDir, 'a', 'b', 'c' );
		await ensureDir( target );
		expect( fs.lstatSync( target ).isDirectory() ).toBe( true );
	} );

	it( 'is a no-op when the directory already exists', async () => {
		const target = path.join( tmpDir, 'existing' );
		fs.mkdirSync( target );
		await expect( ensureDir( target ) ).resolves.toBeUndefined();
		expect( fs.lstatSync( target ).isDirectory() ).toBe( true );
	} );

	it( 'replaces a non-directory file blocking the target path', async () => {
		const plugins = path.join( tmpDir, 'wp-content', 'plugins' );
		fs.mkdirSync( plugins, { recursive: true } );
		const blocker = path.join( plugins, 'akismet' );
		fs.writeFileSync( blocker, '/managed/akismet' );
		expect( fs.lstatSync( blocker ).isFile() ).toBe( true );

		await ensureDir( blocker );

		expect( fs.lstatSync( blocker ).isDirectory() ).toBe( true );
	} );

	it( 'replaces a non-directory file blocking an ancestor of the target path', async () => {
		const plugins = path.join( tmpDir, 'wp-content', 'plugins' );
		fs.mkdirSync( plugins, { recursive: true } );
		const blocker = path.join( plugins, 'akismet' );
		fs.writeFileSync( blocker, '/managed/akismet' );

		const deeper = path.join( blocker, '_inc' );
		await ensureDir( deeper );

		expect( fs.lstatSync( blocker ).isDirectory() ).toBe( true );
		expect( fs.lstatSync( deeper ).isDirectory() ).toBe( true );
	} );
} );

describe( 'rewriteEmptyHexLiterals', () => {
	it( 'rewrites the bare 0x that All-in-One WP Migration writes for an empty blob', () => {
		expect(
			rewriteEmptyHexLiterals( "INSERT INTO `wp_wfconfig` VALUES ('bannedURLs',0x,'yes');" )
		).toBe( "INSERT INTO `wp_wfconfig` VALUES ('bannedURLs',X'','yes');" );
	} );

	it( 'rewrites every bare 0x on the line, including the last value', () => {
		expect( rewriteEmptyHexLiterals( "INSERT INTO `t` VALUES (0x,'a',0x, 0x);" ) ).toBe(
			"INSERT INTO `t` VALUES (X'','a',X'', X'');"
		);
	} );

	it( 'leaves non-empty hex literals untouched', () => {
		const line =
			"INSERT INTO `wp_wfconfig` VALUES ('with_data',0xdeadbeef,'yes'),('upper',0xDEADBEEF,'no');";
		expect( rewriteEmptyHexLiterals( line ) ).toBe( line );
	} );

	it( 'does not touch 0x inside single-quoted strings, even next to escaped quotes', () => {
		const lines = [
			"INSERT INTO `t` VALUES ('a,0x,b');",
			"INSERT INTO `t` VALUES ('it\\'s ,0x, here',0x);",
			"INSERT INTO `t` VALUES ('it''s ,0x, here',0x);",
			"INSERT INTO `t` VALUES ('ends with backslash \\\\',0x);",
		];
		expect( lines.map( rewriteEmptyHexLiterals ) ).toEqual( [
			"INSERT INTO `t` VALUES ('a,0x,b');",
			"INSERT INTO `t` VALUES ('it\\'s ,0x, here',X'');",
			"INSERT INTO `t` VALUES ('it''s ,0x, here',X'');",
			"INSERT INTO `t` VALUES ('ends with backslash \\\\',X'');",
		] );
	} );

	it( 'does not touch 0x inside double-quoted strings or backtick identifiers', () => {
		const line = 'INSERT INTO `0x` (`a0x`) VALUES ("0x, 0x");';
		expect( rewriteEmptyHexLiterals( line ) ).toBe( line );
	} );

	it( 'does not touch identifiers and words that merely contain 0x', () => {
		const line = 'SELECT col0x, 0x_id, 0xg FROM t WHERE x0x = 1;';
		expect( rewriteEmptyHexLiterals( line ) ).toBe( line );
	} );

	it( 'does not touch the rest of a line after a comment marker', () => {
		expect( rewriteEmptyHexLiterals( "INSERT INTO `t` VALUES (0x); -- it's 0x" ) ).toBe(
			"INSERT INTO `t` VALUES (X''); -- it's 0x"
		);
		expect( rewriteEmptyHexLiterals( "-- it's 0x" ) ).toBe( "-- it's 0x" );
		expect( rewriteEmptyHexLiterals( "/* it's 0x */ INSERT INTO `t` VALUES (0x);" ) ).toBe(
			"/* it's 0x */ INSERT INTO `t` VALUES (X'');"
		);
	} );

	it( 'leaves an uppercase 0X alone, since MySQL only accepts the lowercase prefix', () => {
		const line = 'INSERT INTO `t` VALUES (0X);';
		expect( rewriteEmptyHexLiterals( line ) ).toBe( line );
	} );

	it( 'keeps the rest of a line untouched after an unterminated string', () => {
		expect( rewriteEmptyHexLiterals( "INSERT INTO `t` VALUES (0x,'broken,0x" ) ).toBe(
			"INSERT INTO `t` VALUES (X'','broken,0x"
		);
	} );

	it( 'returns lines without 0x unchanged', () => {
		const line = "INSERT INTO `wp_options` VALUES (1,'siteurl','http://example.com','yes');";
		expect( rewriteEmptyHexLiterals( line ) ).toBe( line );
	} );
} );

describe( 'WpressImporter.prepareSqlFile', () => {
	class TestWpressImporter extends WpressImporter {
		public prepare( tmpPath: string ): Promise< void > {
			return this.prepareSqlFile( tmpPath );
		}
	}

	let tmpDir: string;

	beforeEach( () => {
		tmpDir = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-wpress-sql-' ) );
	} );

	afterEach( () => {
		fs.rmSync( tmpDir, { recursive: true, force: true } );
	} );

	it( 'replaces the table prefix placeholder and empty blob literals line by line', async () => {
		const sqlPath = path.join( tmpDir, 'database.sql' );
		fs.writeFileSync(
			sqlPath,
			[
				'-- All-in-One WP Migration SQL Dump',
				'CREATE TABLE `SERVMASK_PREFIX_wfconfig` (`name` varchar(100) NOT NULL, `val` longblob, PRIMARY KEY (`name`));',
				"INSERT INTO `SERVMASK_PREFIX_wfconfig` VALUES ('with_data',0xdeadbeef);",
				"INSERT INTO `SERVMASK_PREFIX_wfconfig` VALUES ('bannedURLs',0x);",
				"INSERT INTO `SERVMASK_PREFIX_options` VALUES (1,'note','see ,0x, in text');",
				'',
			].join( '\r\n' )
		);
		const backup: BackupContents = {
			extractionDirectory: tmpDir,
			wpConfig: '',
			sqlFiles: [ sqlPath ],
			wpContentFiles: [],
			wpContentDirectory: '',
		};

		await new TestWpressImporter( backup ).prepare( sqlPath );

		expect( fs.readFileSync( sqlPath, 'utf8' ) ).toBe(
			[
				'-- All-in-One WP Migration SQL Dump',
				'CREATE TABLE `wp_wfconfig` (`name` varchar(100) NOT NULL, `val` longblob, PRIMARY KEY (`name`));',
				"INSERT INTO `wp_wfconfig` VALUES ('with_data',0xdeadbeef);",
				"INSERT INTO `wp_wfconfig` VALUES ('bannedURLs',X'');",
				"INSERT INTO `wp_options` VALUES (1,'note','see ,0x, in text');",
				'',
			].join( '\n' )
		);
		expect( fs.existsSync( `${ sqlPath }.tmp` ) ).toBe( false );
	} );
} );
