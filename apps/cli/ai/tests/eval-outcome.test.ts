import { existsSync, writeFileSync } from 'fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { expect, it, vi } from 'vitest';
import { fingerprintSites } from 'cli/ai/eval-outcome';
import { readSiteFacts } from 'cli/ai/site-facts';
import { readCliConfig } from 'cli/lib/cli-config/core';
import { createSite } from './fixtures/wordpress-site';

vi.mock( 'cli/lib/cli-config/core', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('cli/lib/cli-config/core') >() ),
	readCliConfig: vi.fn(),
} ) );

// As run 42's active-site-different-name turn only read its site (01a1…6ddc2961).
it( 'fingerprints a site a turn only reads as unchanged, and one it writes to as changed', async () => {
	const { root } = createSite();
	const database = path.join( root, 'wp-content/database/.ht.sqlite' );
	// WordPress's SQLite database runs in WAL mode, whose index a read updates.
	const db = new DatabaseSync( database );
	db.exec( 'PRAGMA journal_mode=WAL' );
	db.close();
	vi.mocked( readCliConfig ).mockResolvedValue( {
		sites: [ { id: 'site', name: 'Site', path: root, port: 8881 } ],
	} as Awaited< ReturnType< typeof readCliConfig > > );
	// A site Studio runs has the mu-plugins its WP-CLI writes when they change.
	await readSiteFacts( root );
	// The site's last request closed the database, which removed its WAL files;
	// a read-only read creates them again and cannot remove them (run 43).
	const last = new DatabaseSync( database );
	last.prepare( 'SELECT 1 FROM wp_options' ).all();
	last.close();
	expect( existsSync( `${ database }-wal` ) ).toBe( false );
	const mtime = async () => ( await fingerprintSites() )[ 0 ].mtimeMs;
	const before = await mtime();
	await new Promise( ( resolve ) => setTimeout( resolve, 20 ) );

	await readSiteFacts( root );
	expect( await mtime() ).toBe( before );

	const write = new DatabaseSync( database );
	write.exec( "INSERT INTO wp_options ( option_name, option_value ) VALUES ( 'changed', '1' )" );
	expect( await mtime() ).toBeGreaterThan( before );
	write.close();
	const written = await mtime();
	await new Promise( ( resolve ) => setTimeout( resolve, 20 ) );

	writeFileSync( path.join( root, 'wp-content/themes/bakery/style.css' ), '/* changed */' );
	expect( await mtime() ).toBeGreaterThan( written );
} );
