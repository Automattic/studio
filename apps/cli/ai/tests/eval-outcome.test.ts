import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'fs';
import { DatabaseSync } from 'node:sqlite';
import os from 'os';
import path from 'path';
import { STUDIO_LOADER_MU_PLUGIN_FILENAME } from '@studio/common/lib/mu-plugins';
import { expect, it, vi } from 'vitest';
import { captureTurnOutcome, fingerprintSites } from 'cli/ai/eval-outcome';
import { readCliConfig } from 'cli/lib/cli-config/core';

vi.mock( 'cli/lib/cli-config/core', async ( importOriginal ) => ( {
	...( await importOriginal< typeof import('cli/lib/cli-config/core') >() ),
	readCliConfig: vi.fn(),
} ) );

// A Studio site's folder: its SQLite database, in WAL mode as WordPress's
// SQLite integration runs it, and a theme. It is the one site Studio has.
function createSite(): string {
	const root = mkdtempSync( path.join( os.tmpdir(), 'eval-outcome-' ) );
	mkdirSync( path.join( root, 'wp-content/database' ), { recursive: true } );
	mkdirSync( path.join( root, 'wp-content/themes/bakery' ), { recursive: true } );
	writeFileSync(
		path.join( root, 'wp-content/themes/bakery/style.css' ),
		'/* Theme Name: Bakery */'
	);
	const db = new DatabaseSync( path.join( root, 'wp-content/database/.ht.sqlite' ) );
	db.exec( 'PRAGMA journal_mode=WAL' );
	db.exec( 'CREATE TABLE wp_options ( option_name TEXT, option_value TEXT )' );
	db.close();
	vi.mocked( readCliConfig ).mockResolvedValue( {
		sites: [ { id: 'site', name: 'Site', path: root, port: 8881 } ],
	} as Awaited< ReturnType< typeof readCliConfig > > );
	return root;
}

const tick = () => new Promise( ( resolve ) => setTimeout( resolve, 20 ) );

// As run 42's and 43's active-site-different-name turns only read their site.
it( 'fingerprints a site a turn only reads as unchanged, and one it writes to as changed', async () => {
	const root = createSite();
	const database = path.join( root, 'wp-content/database/.ht.sqlite' );
	// The site's last request closed the database, which removed its WAL files;
	// a read-only read creates them again and cannot remove them
	// (https://sqlite.org/walformat.html).
	expect( existsSync( `${ database }-wal` ) ).toBe( false );
	const mtime = async () => ( await fingerprintSites() )[ 0 ].mtimeMs;
	const before = await mtime();
	await tick();

	const read = new DatabaseSync( database, { readOnly: true } );
	read.prepare( 'SELECT 1 FROM wp_options' ).all();
	read.close();
	expect( await mtime() ).toBe( before );

	const write = new DatabaseSync( database );
	write.exec( "INSERT INTO wp_options ( option_name, option_value ) VALUES ( 'changed', '1' )" );
	expect( await mtime() ).toBeGreaterThan( before );
	write.close();
	rmSync( root, { recursive: true, force: true } );
} );

// As run 52's preview-vs-remote turns, whose site_list had Studio rewrite the
// loader of a site the turn only read, after a build changed Studio's mu-plugins.
it( "fingerprints a site whose Studio loader Studio rewrote as unchanged, and a mu-plugin of the site's as changed", async () => {
	const root = createSite();
	const muPlugins = path.join( root, 'wp-content/mu-plugins' );
	const loader = path.join( muPlugins, STUDIO_LOADER_MU_PLUGIN_FILENAME );
	mkdirSync( muPlugins, { recursive: true } );
	writeFileSync( loader, "<?php require '/studio/mu-plugins/old/loader.php';" );
	const before = ( await fingerprintSites() )[ 0 ];
	const othersChanged = async ( from: typeof before ) =>
		( await captureTurnOutcome( [ from ], undefined, root ) ).otherSitesChanged;
	await tick();

	// As writeStudioMuPlugins() rewrites it: a temporary file renamed over it.
	writeFileSync( `${ loader }.tmp`, "<?php require '/studio/mu-plugins/new/loader.php';" );
	renameSync( `${ loader }.tmp`, loader );
	expect( await othersChanged( before ) ).toEqual( [] );

	writeFileSync( path.join( muPlugins, 'site.php' ), '<?php' );
	expect( await othersChanged( before ) ).toEqual( [ 'Site' ] );

	// A removal moves only the folder's own time.
	const added = ( await fingerprintSites() )[ 0 ];
	rmSync( path.join( muPlugins, 'site.php' ) );
	expect( await othersChanged( added ) ).toEqual( [ 'Site' ] );
	rmSync( root, { recursive: true, force: true } );
} );
