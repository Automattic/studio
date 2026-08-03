import fs from 'fs';
import { DatabaseSync } from 'node:sqlite';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetSqliteJournalModeToRollback } from '../reset-sqlite-journal-mode';

function getJournalMode( dbPath: string ): string {
	const database = new DatabaseSync( dbPath );
	try {
		return String(
			( database.prepare( 'PRAGMA journal_mode' ).get() as { journal_mode: string } ).journal_mode
		);
	} finally {
		database.close();
	}
}

describe( 'resetSqliteJournalModeToRollback', () => {
	let sitePath: string;
	let dbPath: string;

	beforeEach( () => {
		sitePath = fs.mkdtempSync( path.join( os.tmpdir(), 'reset-journal-' ) );
		dbPath = path.join( sitePath, 'wp-content', 'database', '.ht.sqlite' );
		fs.mkdirSync( path.dirname( dbPath ), { recursive: true } );
	} );

	afterEach( () => {
		fs.rmSync( sitePath, { recursive: true, force: true } );
	} );

	it( 'converts a WAL-mode database to rollback (DELETE) mode', () => {
		const database = new DatabaseSync( dbPath );
		database.exec( 'PRAGMA journal_mode = WAL' );
		database.exec( 'CREATE TABLE t ( id INTEGER )' );
		database.close();
		expect( getJournalMode( dbPath ) ).toBe( 'wal' );

		return resetSqliteJournalModeToRollback( sitePath ).then( () => {
			expect( getJournalMode( dbPath ) ).toBe( 'delete' );
		} );
	} );

	it( 'is a no-op when the database file does not exist', async () => {
		fs.rmSync( path.dirname( dbPath ), { recursive: true, force: true } );
		await expect( resetSqliteJournalModeToRollback( sitePath ) ).resolves.toBeUndefined();
	} );
} );
