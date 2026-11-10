import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readSiteTablePrefix, setSiteTablePrefix } from 'cli/lib/wp-config-table-prefix';

describe( 'wp-config.php table prefix', () => {
	let root: string;
	let sitePath: string;
	let wpConfigPath: string;

	const wpConfig = ( assignment: string ) =>
		[
			'<?php',
			"define( 'DB_NAME', 'wordpress' );",
			'',
			'/**',
			' * You can have multiple installations in one database if you give each',
			' * a unique prefix. Only numbers, letters, and underscores please!',
			' */',
			assignment,
			'',
			"require_once ABSPATH . 'wp-settings.php';",
			'',
		].join( '\n' );

	beforeEach( () => {
		root = fs.mkdtempSync( path.join( os.tmpdir(), 'studio-table-prefix-' ) );
		sitePath = path.join( root, 'site' );
		fs.mkdirSync( sitePath );
		wpConfigPath = path.join( sitePath, 'wp-config.php' );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
		fs.rmSync( root, { recursive: true, force: true } );
	} );

	describe( 'setSiteTablePrefix', () => {
		it( "replaces the site's prefix with the remote's and keeps the rest of the file", () => {
			fs.writeFileSync( wpConfigPath, wpConfig( "$table_prefix = 'wp_';" ) );

			expect( setSiteTablePrefix( sitePath, 'ntmozf_' ) ).toBe( 'updated' );

			expect( fs.readFileSync( wpConfigPath, 'utf8' ) ).toBe(
				wpConfig( "$table_prefix = 'ntmozf_';" )
			);
			expect( fs.existsSync( `${ wpConfigPath }.studio-tmp` ) ).toBe( false );
		} );

		it( 'keeps the quotes, spacing and line endings of the assignment', () => {
			const original = wpConfig( '  $table_prefix  =  "wp_" ;' ).replace( /\n/g, '\r\n' );
			fs.writeFileSync( wpConfigPath, original );

			expect( setSiteTablePrefix( sitePath, 'site2_' ) ).toBe( 'updated' );

			expect( fs.readFileSync( wpConfigPath, 'utf8' ) ).toBe(
				original.replace( '"wp_"', '"site2_"' )
			);
		} );

		it( 'changes a commented-out assignment too, so the one PHP runs is always set', () => {
			fs.writeFileSync(
				wpConfigPath,
				wpConfig( "/*\n$table_prefix = 'old_';\n*/\n$table_prefix = 'wp_';" )
			);

			expect( setSiteTablePrefix( sitePath, 'ntmozf_' ) ).toBe( 'updated' );

			expect( readSiteTablePrefix( sitePath ) ).toBe( 'ntmozf_' );
			expect( fs.readFileSync( wpConfigPath, 'utf8' ) ).not.toMatch( /'(old|wp)_'/ );
		} );

		// Windows reports every file as 0o666.
		it.skipIf( process.platform === 'win32' )( 'keeps the file mode', () => {
			fs.writeFileSync( wpConfigPath, wpConfig( "$table_prefix = 'wp_';" ) );
			fs.chmodSync( wpConfigPath, 0o640 );

			setSiteTablePrefix( sitePath, 'ntmozf_' );

			expect( fs.statSync( wpConfigPath ).mode & 0o777 ).toBe( 0o640 );
		} );

		it( 'leaves the file alone when the prefix already matches', () => {
			fs.writeFileSync( wpConfigPath, wpConfig( "$table_prefix = 'wp_';" ) );
			const before = fs.statSync( wpConfigPath ).mtimeMs;

			expect( setSiteTablePrefix( sitePath, 'wp_' ) ).toBe( 'unchanged' );

			expect( fs.statSync( wpConfigPath ).mtimeMs ).toBe( before );
		} );

		it( "doesn't write through a link to the pulled wp-config.php", () => {
			const pulledWpConfig = path.join( root, 'raw-wp-config.php' );
			fs.writeFileSync( pulledWpConfig, wpConfig( "$table_prefix = 'ntmozf_';" ) );
			fs.symlinkSync( pulledWpConfig, wpConfigPath );

			expect( setSiteTablePrefix( sitePath, 'other_' ) ).toBe( 'linked' );

			expect( fs.readFileSync( pulledWpConfig, 'utf8' ) ).toBe(
				wpConfig( "$table_prefix = 'ntmozf_';" )
			);
		} );

		it( 'reports a missing wp-config.php', () => {
			expect( setSiteTablePrefix( sitePath, 'ntmozf_' ) ).toBe( 'missing' );
			expect( fs.existsSync( wpConfigPath ) ).toBe( false );
		} );

		it( 'reports a wp-config.php without a $table_prefix assignment', () => {
			fs.writeFileSync( wpConfigPath, wpConfig( '' ) );

			expect( setSiteTablePrefix( sitePath, 'ntmozf_' ) ).toBe( 'no-assignment' );
		} );

		it( 'refuses a prefix WordPress would reject, without touching the file', () => {
			fs.writeFileSync( wpConfigPath, wpConfig( "$table_prefix = 'wp_';" ) );

			expect( setSiteTablePrefix( sitePath, "x'; exit; //" ) ).toBe( 'invalid-prefix' );

			expect( fs.readFileSync( wpConfigPath, 'utf8' ) ).toBe(
				wpConfig( "$table_prefix = 'wp_';" )
			);
		} );

		it( 'reports a failed write and leaves the file as it was', () => {
			fs.writeFileSync( wpConfigPath, wpConfig( "$table_prefix = 'wp_';" ) );
			vi.spyOn( fs, 'renameSync' ).mockImplementationOnce( () => {
				throw Object.assign( new Error( 'EBUSY: resource busy or locked' ), { code: 'EBUSY' } );
			} );

			expect( setSiteTablePrefix( sitePath, 'ntmozf_' ) ).toBe( 'write-failed' );

			expect( fs.readFileSync( wpConfigPath, 'utf8' ) ).toBe(
				wpConfig( "$table_prefix = 'wp_';" )
			);
			expect( fs.existsSync( `${ wpConfigPath }.studio-tmp` ) ).toBe( false );
		} );

		it( 'sets a prefix on the same line as the opening PHP tag', () => {
			fs.writeFileSync( wpConfigPath, "<?php $table_prefix = 'wp_';\n" );

			expect( setSiteTablePrefix( sitePath, 'ntmozf_' ) ).toBe( 'updated' );

			expect( fs.readFileSync( wpConfigPath, 'utf8' ) ).toBe(
				"<?php $table_prefix = 'ntmozf_';\n"
			);
		} );
	} );

	describe( 'readSiteTablePrefix', () => {
		it( 'reads the last assignment, as PHP does', () => {
			fs.writeFileSync(
				wpConfigPath,
				wpConfig( "/*\n$table_prefix = 'old_';\n*/\n$table_prefix = 'ntmozf_';" )
			);

			expect( readSiteTablePrefix( sitePath ) ).toBe( 'ntmozf_' );
		} );

		it( 'falls back to wp_ without a wp-config.php or an assignment', () => {
			expect( readSiteTablePrefix( sitePath ) ).toBe( 'wp_' );

			fs.writeFileSync( wpConfigPath, wpConfig( '' ) );
			expect( readSiteTablePrefix( sitePath ) ).toBe( 'wp_' );
		} );
	} );
} );
