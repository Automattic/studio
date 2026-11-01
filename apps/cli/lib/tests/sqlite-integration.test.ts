import fs from 'fs';
import { DatabaseSync } from 'node:sqlite';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { restoreFixedDatabasePath } from '../sqlite-integration';

const RECORDED_DIR = '.ht.0123456789abcdef0123456789abcdef';
const PINNED_DROPIN = `<?php define( 'DB_PATH', __DIR__ . '/database/.ht.sqlite' );`;

function createDatabase( dbPath: string, postCount: number ) {
	fs.mkdirSync( path.dirname( dbPath ), { recursive: true } );
	const database = new DatabaseSync( dbPath );
	database.exec( 'CREATE TABLE wp_posts ( ID INTEGER PRIMARY KEY )' );
	for ( let id = 1; id <= postCount; id++ ) {
		database.exec( `INSERT INTO wp_posts VALUES ( ${ id } )` );
	}
	database.close();
}

function countPosts( dbPath: string ): number {
	const database = new DatabaseSync( dbPath, { readOnly: true } );
	const row = database.prepare( 'SELECT COUNT(*) AS total FROM wp_posts' ).get();
	database.close();
	return ( row as { total: number } ).total;
}

describe( 'restoreFixedDatabasePath', () => {
	let sitePath: string;
	let databasePath: string;
	let fixedPath: string;
	let recordedPath: string;
	let pathFile: string;

	beforeEach( () => {
		sitePath = fs.mkdtempSync( path.join( os.tmpdir(), 'restore-database-path-' ) );
		databasePath = path.join( sitePath, 'wp-content', 'database' );
		fixedPath = path.join( databasePath, '.ht.sqlite' );
		recordedPath = path.join( databasePath, RECORDED_DIR, '.ht.sqlite' );
		pathFile = path.join( databasePath, 'db-path.php' );

		fs.mkdirSync( databasePath, { recursive: true } );
		fs.writeFileSync( path.join( sitePath, 'wp-config.php' ), `<?php $table_prefix = 'wp_';` );
		fs.writeFileSync( path.join( sitePath, 'wp-content', 'db.php' ), PINNED_DROPIN );
		fs.writeFileSync( pathFile, `<?php return __DIR__ . '/${ RECORDED_DIR }/.ht.sqlite';` );
	} );

	afterEach( () => {
		fs.rmSync( sitePath, { recursive: true, force: true } );
	} );

	it( 'moves the recorded database to the fixed path and keeps the one it replaces', async () => {
		createDatabase( fixedPath, 1 );
		createDatabase( recordedPath, 3 );

		await restoreFixedDatabasePath( sitePath );

		expect( countPosts( fixedPath ) ).toBe( 3 );
		expect( countPosts( `${ fixedPath }.replaced` ) ).toBe( 1 );
		expect( fs.existsSync( pathFile ) ).toBe( false );
	} );

	it( 'moves the recorded database over an empty file left by a failed import', async () => {
		fs.writeFileSync( fixedPath, '' );
		createDatabase( recordedPath, 3 );

		await restoreFixedDatabasePath( sitePath );

		expect( countPosts( fixedPath ) ).toBe( 3 );
	} );

	it( 'keeps the database at the fixed path when it has more posts', async () => {
		createDatabase( fixedPath, 3 );
		createDatabase( recordedPath, 1 );

		await restoreFixedDatabasePath( sitePath );

		expect( countPosts( fixedPath ) ).toBe( 3 );
		expect( countPosts( recordedPath ) ).toBe( 1 );
		expect( fs.existsSync( pathFile ) ).toBe( false );
	} );

	it( 'removes a path file whose database does not exist', async () => {
		createDatabase( fixedPath, 1 );

		await restoreFixedDatabasePath( sitePath );

		expect( countPosts( fixedPath ) ).toBe( 1 );
		expect( fs.existsSync( pathFile ) ).toBe( false );
	} );

	it( 'leaves a site with an unpinned drop-in alone', async () => {
		fs.writeFileSync( path.join( sitePath, 'wp-content', 'db.php' ), '<?php // Custom drop-in' );
		createDatabase( recordedPath, 3 );

		await restoreFixedDatabasePath( sitePath );

		expect( fs.existsSync( fixedPath ) ).toBe( false );
		expect( fs.existsSync( pathFile ) ).toBe( true );
	} );
} );
