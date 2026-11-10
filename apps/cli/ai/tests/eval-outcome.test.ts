import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { seenFields, visitorValue } from '@studio/agent/node/form-submission';
import { readSiteFacts } from '@studio/agent/node/site-facts';
import { createSite } from '@studio/agent/node/tests/fixtures/wordpress-site';
import { STUDIO_LOADER_MU_PLUGIN_FILENAME } from '@studio/common/lib/mu-plugins';
import { chromium } from 'playwright';
import { expect, it, vi } from 'vitest';
import { captureTurnOutcome, fingerprintSites } from 'cli/ai/eval-outcome';
import { cliAgentHost } from 'cli/ai/host';
import { readCliConfig } from 'cli/lib/cli-config/core';

// The site's WordPress is not run: what its code registers is read by admin-capabilities' tests.
vi.mock( 'cli/lib/daemon-client', () => ( {
	connectToDaemon: vi.fn(),
	disconnectFromDaemon: vi.fn(),
} ) );
vi.mock( 'cli/lib/run-wp-cli-command', () => ( {
	runWpCliCommand: vi.fn( async () => {
		throw new Error( 'WordPress is not run in this test' );
	} ),
} ) );
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
	// The facts a turn's start reads.
	await readSiteFacts( cliAgentHost, root );
	// The site's last request closed the database, which removed its WAL files;
	// a read-only read creates them again and cannot remove them (run 43).
	const last = new DatabaseSync( database );
	last.prepare( 'SELECT 1 FROM wp_options' ).all();
	last.close();
	expect( existsSync( `${ database }-wal` ) ).toBe( false );
	const mtime = async () => ( await fingerprintSites() )[ 0 ].mtimeMs;
	const before = await mtime();
	await new Promise( ( resolve ) => setTimeout( resolve, 20 ) );

	await readSiteFacts( cliAgentHost, root );
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

// As run 52's preview-vs-remote turns, whose site_list had Studio rewrite the
// loader of a site the turn only read, after a build changed Studio's mu-plugins.
it( "fingerprints a site whose Studio loader Studio rewrote as unchanged, and a mu-plugin of the site's as changed", async () => {
	const { root } = createSite();
	vi.mocked( readCliConfig ).mockResolvedValue( {
		sites: [ { id: 'site', name: 'Site', path: root, port: 8881 } ],
	} as Awaited< ReturnType< typeof readCliConfig > > );
	const muPlugins = path.join( root, 'wp-content/mu-plugins' );
	const loader = path.join( muPlugins, STUDIO_LOADER_MU_PLUGIN_FILENAME );
	mkdirSync( muPlugins, { recursive: true } );
	writeFileSync( loader, "<?php require '/studio/mu-plugins/old/loader.php';" );
	const before = ( await fingerprintSites() )[ 0 ];
	await new Promise( ( resolve ) => setTimeout( resolve, 20 ) );

	// As writeStudioMuPlugins() rewrites it: a temporary file renamed over it.
	writeFileSync( `${ loader }.tmp`, "<?php require '/studio/mu-plugins/new/loader.php';" );
	renameSync( `${ loader }.tmp`, loader );
	const loaded = ( await fingerprintSites() )[ 0 ];
	expect( loaded.mtimeMs ).toBe( before.mtimeMs );
	expect( loaded.code ).toEqual( before.code );

	writeFileSync( path.join( muPlugins, 'site.php' ), '<?php' );
	const changed = ( await fingerprintSites() )[ 0 ];
	expect( changed.mtimeMs ).toBeGreaterThan( before.mtimeMs );
	expect( Object.keys( changed.code ) ).toContain( 'mu-plugins/site.php' );
	expect( ( await captureTurnOutcome( [ before ], undefined, root ) ).otherSitesChanged ).toEqual( [
		'Site',
	] );

	// A removal moves only the folder's time; the code hashes tell it.
	const added = ( await fingerprintSites() )[ 0 ];
	rmSync( path.join( muPlugins, 'site.php' ) );
	expect( ( await captureTurnOutcome( [ added ], undefined, root ) ).otherSitesChanged ).toEqual( [
		'Site',
	] );
	expect( ( await captureTurnOutcome( [ before ], undefined, root ) ).otherSitesChanged ).toEqual(
		[]
	);
} );

// eval30 pivot: the scorer typed "Eval Visitor" into Jetpack's date field and 1
// into a guest count of at least 2, so the form's script (and the browser, for a
// date input) refused the inquiry before sending it: "Please enter a valid date."
it.runIf( existsSync( chromium.executablePath() ) )(
	'types what each field asks for: a date in its format, a number within its range',
	async () => {
		const browser = await chromium.launch();
		try {
			const page = await browser.newPage();
			await page.setContent( `<form>
				<input type="text" name="name" required>
				<input type="date" name="date" required>
				<input type="text" name="jp-iso" class="date jp-contact-form-date" data-format="yy-mm-dd">
				<input type="text" name="jp-us" class="date jp-contact-form-date" data-format="mm/dd/yy">
				<input type="number" name="guests" min="2" required>
				<input type="number" name="tiny" max="0">
				<input type="search" name="s">
			</form>` );
			const values: Record< string, string | undefined > = {};
			for ( const field of await page.locator( 'input' ).all() ) {
				const value = await visitorValue( field );
				values[ ( await field.getAttribute( 'name' ) ) as string ] = value;
				if ( value !== undefined ) await field.fill( value );
			}
			expect( values.name ).toBe( 'Test Visitor' );
			expect( values.date ).toMatch( /^\d{4}-\d{2}-\d{2}$/ );
			expect( values[ 'jp-iso' ] ).toBe( values.date );
			const [ y, m, d ] = ( values.date as string ).split( '-' );
			expect( values[ 'jp-us' ] ).toBe( `${ m }/${ d }/${ y }` );
			expect( values.guests ).toBe( '2' );
			expect( values.tiny ).toBe( '0' );
			expect( values.s ).toBeUndefined();
			expect(
				await page.locator( 'form' ).evaluate( ( f: HTMLFormElement ) => f.checkValidity() )
			).toBe( true );
		} finally {
			await browser.close();
		}
	}
);

// eval21 redo port 2: the scorer filled the booking form's spam trap, a field
// moved off the page in a box clipped to nothing, and the form dropped the message.
it.runIf( existsSync( chromium.executablePath() ) )(
	'fills only the fields a visitor sees, not a spam trap hidden from them',
	async () => {
		const browser = await chromium.launch();
		try {
			const page = await browser.newPage();
			await page.setContent( `<form>
				<p style="position:absolute;left:-9999px;height:0;overflow:hidden" aria-hidden="true"><input name="trap-offpage"></p>
				<p style="height:0;overflow:hidden"><input name="trap-clipped"></p>
				<div aria-hidden="true"><input name="trap-aria"></div>
				<div style="overflow:auto;height:80px"><input name="name"><select name="artist"><option>Kestrel</option></select></div>
				<textarea name="idea"></textarea>
			</form>` );
			const names = async ( selector: string ) =>
				Promise.all(
					( await seenFields( page.locator( 'form' ), selector ) ).map( ( field ) =>
						field.getAttribute( 'name' )
					)
				);
			expect( [
				...( await names( 'input:visible' ) ),
				...( await names( 'select:visible' ) ),
			] ).toEqual( [ 'name', 'artist' ] );
		} finally {
			await browser.close();
		}
	}
);
