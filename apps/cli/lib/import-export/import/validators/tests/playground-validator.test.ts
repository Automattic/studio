import path from 'path';
import { describe, expect, it } from 'vitest';
import { PlaygroundValidator } from '../playground-validator';

describe( 'PlaygroundValidator', () => {
	it( 'imports the randomized database but no other file of the database directory', () => {
		const database = 'wp-content/database/.ht.0123456789abcdef/.ht.sqlite';
		const plugin = 'wp-content/plugins/hello.php';

		const { sqlFiles, wpContentFiles } = new PlaygroundValidator().parseBackupContents(
			[ database, 'wp-content/database/db-path.php', plugin ],
			'/extracted'
		);

		expect( sqlFiles ).toEqual( [ path.join( '/extracted', database ) ] );
		expect( wpContentFiles ).toEqual( [ path.join( '/extracted', plugin ) ] );
	} );
} );
