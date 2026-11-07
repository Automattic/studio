import { spawn } from 'child_process';
import fs from 'fs';
import { DatabaseSync } from 'node:sqlite';
import os from 'os';
import path from 'path';
import { getSiteVersion } from 'cli/lib/site-versions';

describe( 'site versions', () => {
	let root: string;
	let site: string;

	const write = ( relativePath: string, content: string ) => {
		fs.mkdirSync( path.dirname( path.join( site, relativePath ) ), { recursive: true } );
		fs.writeFileSync( path.join( site, relativePath ), content );
	};
	const query = ( sql: string ) => {
		const database = new DatabaseSync( path.join( site, 'wp-content/database/.ht.sqlite' ) );
		database.exec( sql );
		database.close();
	};

	beforeEach( () => {
		root = fs.mkdtempSync( path.join( os.tmpdir(), 'site-versions-' ) );
		vi.stubEnv( 'DEV_CONFIG_DIR', path.join( root, 'config' ) );
		site = path.join( root, 'site' );
		write( 'wp-config.php', "<?php $table_prefix = 'wp_';" );
		write( 'wp-content/themes/active/style.css', 'body {}' );
		write( 'wp-content/themes/inactive/style.css', 'body {}' );
		write( 'wp-content/database/.ht.sqlite', '' );
		query(
			`CREATE TABLE wp_options (option_name TEXT, option_value TEXT);
			CREATE TABLE wp_usermeta (meta_key TEXT, meta_value TEXT);
			CREATE TABLE wp_postmeta (meta_key TEXT, meta_value TEXT);
			CREATE TABLE wp_posts (post_title TEXT, post_status TEXT);
			INSERT INTO wp_options VALUES ('stylesheet', 'active'), ('template', 'active'), ('blogname', 'Site');`
		);
	} );

	afterEach( () => {
		vi.unstubAllEnvs();
		fs.rmSync( root, { recursive: true, force: true } );
	} );

	it.each( [
		[
			'visits to the site and its admin',
			false,
			() =>
				query(
					`INSERT INTO wp_options VALUES ('_transient_x', '1'), ('cron', 'a:0:{}');
					INSERT INTO wp_usermeta VALUES ('session_tokens', 'a:1:{}');
					INSERT INTO wp_postmeta VALUES ('_edit_lock', '1:1');
					INSERT INTO wp_posts VALUES ('Auto Draft', 'auto-draft');`
				),
		],
		[ 'a published post', true, () => query( "INSERT INTO wp_posts VALUES ('Hello', 'publish')" ) ],
		[ 'a debug log', false, () => write( 'wp-content/debug.log', 'notice' ) ],
		[ 'a page cache', false, () => write( 'wp-content/cache/page_optimize/a', 'css' ) ],
		[
			'a file rewritten with the same content',
			false,
			() => write( 'wp-content/themes/active/style.css', 'body {}' ),
		],
		[
			'an edited theme file',
			true,
			() => write( 'wp-content/themes/active/style.css', 'body { color: red }' ),
		],
		[ 'a new upload', true, () => write( 'wp-content/uploads/a.jpg', 'jpg' ) ],
		[
			'a changed option',
			true,
			() =>
				query( "UPDATE wp_options SET option_value = 'Renamed' WHERE option_name = 'blogname'" ),
		],
	] )( 'tells whether the site changed after %s', async ( _, changed, change ) => {
		const version = await getSiteVersion( 'one', site );
		change();
		expect( ( await getSiteVersion( 'one', site ) ) === version ).toBe( ! changed );
	} );

	it( 'reads the same version while the running site writes to its database', async () => {
		const version = await getSiteVersion( 'one', site );
		// Another process holds the write lock, as a running site does, for half a second.
		const writer = spawn( process.execPath, [
			'-e',
			`const { DatabaseSync } = require( 'node:sqlite' );
			const database = new DatabaseSync( ${ JSON.stringify(
				path.join( site, 'wp-content/database/.ht.sqlite' )
			) } );
			database.exec( "BEGIN EXCLUSIVE; UPDATE wp_options SET option_value = 'Site' WHERE option_name = 'blogname'" );
			console.log( 'locked' );
			setTimeout( () => database.exec( 'COMMIT' ), 500 );`,
		] );
		await new Promise( ( resolve ) => writer.stdout.once( 'data', resolve ) );
		expect( await getSiteVersion( 'one', site ) ).toBe( version );
	} );

	it( 'keeps one file of hashes per site, however many versions it has', async () => {
		await getSiteVersion( 'one', site );
		write( 'wp-content/uploads/a.jpg', 'jpg' );
		await getSiteVersion( 'one', site );
		expect( fs.readdirSync( path.join( root, 'config', 'versions' ) ) ).toEqual( [ 'one.json' ] );
	} );
} );
