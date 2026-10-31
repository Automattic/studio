import fs from 'fs';
import { DatabaseSync } from 'node:sqlite';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	getTablesWithBinaryLiteralDefaults,
	restoreBinaryLiteralDefaults,
} from '../binary-literal-defaults';

describe( 'binary-literal-defaults', () => {
	let sitePath: string;

	beforeEach( () => {
		sitePath = fs.mkdtempSync( path.join( os.tmpdir(), 'binary-defaults-' ) );
	} );

	afterEach( () => {
		fs.rmSync( sitePath, { recursive: true, force: true } );
	} );

	describe( 'getTablesWithBinaryLiteralDefaults', () => {
		it( 'finds binary columns with hex and bit defaults only', async () => {
			const dbPath = path.join( sitePath, 'wp-content', 'database', '.ht.sqlite' );
			fs.mkdirSync( path.dirname( dbPath ), { recursive: true } );
			const database = new DatabaseSync( dbPath );
			database.exec( `
				CREATE TABLE _wp_sqlite_mysql_information_schema_columns (
					TABLE_NAME TEXT, DATA_TYPE TEXT, COLUMN_DEFAULT TEXT
				);
				INSERT INTO _wp_sqlite_mysql_information_schema_columns VALUES
					( 'wp_pulled', 'binary', 'x''00''' ),
					( 'wp_pulled', 'varbinary', 'X''00''' ),
					( 'wp_dumped', 'binary', '0x00' ),
					( 'wp_bits', 'binary', 'b''01''' ),
					( 'wp_fresh', 'binary', '' ),
					( 'wp_none', 'varbinary', NULL ),
					( 'wp_text', 'varchar', 'x''00''' );
			` );
			database.close();

			const tables = await getTablesWithBinaryLiteralDefaults( sitePath );

			expect( [ ...tables ].sort() ).toEqual( [ 'wp_bits', 'wp_dumped', 'wp_pulled' ] );
		} );

		it( 'returns nothing when the database cannot be read', async () => {
			await expect( getTablesWithBinaryLiteralDefaults( sitePath ) ).resolves.toEqual( new Set() );
		} );
	} );

	describe( 'restoreBinaryLiteralDefaults', () => {
		const zeros = '00000000000000000000000000000000';

		it( 'writes hex and bit defaults as literals and leaves everything else alone', async () => {
			const dumpPath = path.join( sitePath, 'dump.sql' );
			const row = Buffer.concat( [
				Buffer.from( "INSERT INTO `wp_t` VALUES ('  `IP` binary(16) DEFAULT ''0x00''','" ),
				Buffer.from( [ 0xde, 0xad, 0xbe, 0xef ] ),
				Buffer.from( "');\n" ),
			] );
			fs.writeFileSync(
				dumpPath,
				Buffer.concat( [
					Buffer.from(
						[
							'CREATE TABLE `wp_t` (',
							`  \`a\` binary(16) NOT NULL DEFAULT 'x''${ zeros }''',`,
							`  \`b\` binary(16) DEFAULT '0x${ zeros }',`,
							"  `c` varbinary(16) NOT NULL DEFAULT 'X''DEADBEEF''' COMMENT 'x''00''',",
							"  `d` binary(1) NOT NULL DEFAULT 'b''01000001''',",
							"  `e` binary(16) NOT NULL DEFAULT '\\0\\0\\0\\0',",
							"  `f` binary(4) NOT NULL DEFAULT 'abcd',",
							"  `g` varchar(16) NOT NULL DEFAULT 'x''41''',",
							') ENGINE=InnoDB;',
							'',
						].join( '\n' )
					),
					row,
				] )
			);

			await restoreBinaryLiteralDefaults( dumpPath );

			expect( fs.readdirSync( sitePath ) ).toEqual( [ 'dump.sql' ] );
			expect( fs.readFileSync( dumpPath ) ).toEqual(
				Buffer.concat( [
					Buffer.from(
						[
							'CREATE TABLE `wp_t` (',
							`  \`a\` binary(16) NOT NULL DEFAULT x'${ zeros }',`,
							`  \`b\` binary(16) DEFAULT 0x${ zeros },`,
							"  `c` varbinary(16) NOT NULL DEFAULT X'DEADBEEF' COMMENT 'x''00''',",
							"  `d` binary(1) NOT NULL DEFAULT b'01000001',",
							"  `e` binary(16) NOT NULL DEFAULT '\\0\\0\\0\\0',",
							"  `f` binary(4) NOT NULL DEFAULT 'abcd',",
							"  `g` varchar(16) NOT NULL DEFAULT 'x''41''',",
							') ENGINE=InnoDB;',
							'',
						].join( '\n' )
					),
					row,
				] )
			);
		} );
	} );
} );
