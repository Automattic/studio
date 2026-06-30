import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getNativeDbNameFallbackArgs } from 'cli/lib/run-wp-cli-command';

const DB_NAME_EXEC_ARG = "--exec=defined('DB_NAME') || define('DB_NAME', 'wordpress');";

describe( 'getNativeDbNameFallbackArgs', () => {
	let siteDir: string;

	beforeEach( () => {
		siteDir = mkdtempSync( path.join( tmpdir(), 'studio-dbname-test-' ) );
	} );

	afterEach( () => {
		rmSync( siteDir, { recursive: true, force: true } );
	} );

	function writeWpConfig( contents: string ): void {
		writeFileSync( path.join( siteDir, 'wp-config.php' ), contents );
	}

	it( 'injects the DB_NAME fallback when wp-config.php does not define it', () => {
		// Studio strips DB_NAME from wp-config.php; only comments reference it.
		writeWpConfig( `<?php\n/**\n * DB_NAME\n */\n$table_prefix = 'wp_';\n` );
		expect( getNativeDbNameFallbackArgs( siteDir ) ).toEqual( [ DB_NAME_EXEC_ARG ] );
	} );

	it( 'does not inject when wp-config.php defines DB_NAME (spaced form)', () => {
		writeWpConfig( `<?php\ndefine( 'DB_NAME', 'wordpress' );\n` );
		expect( getNativeDbNameFallbackArgs( siteDir ) ).toEqual( [] );
	} );

	it( 'does not inject when wp-config.php defines DB_NAME (compact / double-quoted form)', () => {
		writeWpConfig( `<?php\ndefine("DB_NAME","wordpress");\n` );
		expect( getNativeDbNameFallbackArgs( siteDir ) ).toEqual( [] );
	} );

	it( 'returns no args when wp-config.php is missing', () => {
		expect( getNativeDbNameFallbackArgs( siteDir ) ).toEqual( [] );
	} );
} );
