import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { DatabaseSync } from 'node:sqlite';
import os from 'os';
import path from 'path';
import { arePathsEqual } from '@studio/common/lib/fs-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getFileWriteRefusal } from 'cli/ai/runtimes/pi/tool-safety';
import { findSiteByFolder } from 'cli/lib/cli-config/sites';

vi.mock( 'cli/lib/cli-config/sites', () => ( { findSiteByFolder: vi.fn() } ) );

let root: string;
const studioSite = () => path.join( root, 'my-site' );
const unmanaged = () => path.join( root, 'wordpress-develop', 'src' );
const isStudioSite = async ( folder: string ) => arePathsEqual( folder, studioSite() );

function makeWordPressTree( dir: string ) {
	mkdirSync( path.join( dir, 'wp-includes' ), { recursive: true } );
	mkdirSync( path.join( dir, 'wp-content' ), { recursive: true } );
}

beforeEach( () => {
	root = mkdtempSync( path.join( os.tmpdir(), 'studio-core-guard-' ) );
	makeWordPressTree( studioSite() );
	makeWordPressTree( unmanaged() );
	for ( const [ theme, header ] of [ [ 'twentytwentyfive', 'Theme Name: Twenty Twenty-Five' ] ] ) {
		const dir = path.join( studioSite(), 'wp-content', 'themes', theme );
		mkdirSync( dir, { recursive: true } );
		writeFileSync( path.join( dir, 'style.css' ), `/*\n${ header }\n*/` );
	}
} );

afterEach( () => {
	rmSync( root, { recursive: true, force: true } );
	vi.mocked( findSiteByFolder ).mockReset();
} );

describe( 'getFileWriteRefusal', () => {
	it.each( [
		'my-site/wp-includes/functions.php',
		'my-site/wp-admin/includes/file.php',
		'my-site/wp-settings.php',
		'my-site/index.php',
		'my-site/xmlrpc.php',
	] )( "refuses a Studio site's core file %s, naming wp-content", async ( file ) => {
		for ( const tool of [ 'Write', 'Edit' ] ) {
			const refusal = await getFileWriteRefusal( tool, { path: file }, root, isStudioSite );
			expect( refusal ).toContain( 'wp-content/' );
		}
	} );

	it( 'refuses a theme WordPress updates, by its last update check, naming a child theme', async () => {
		for ( const theme of [ 'premium', 'client-theme', 'café', 'fresh' ] ) {
			const dir = path.join( studioSite(), 'wp-content', 'themes', theme );
			mkdirSync( dir, { recursive: true } );
			writeFileSync( path.join( dir, 'style.css' ), `/*\nTheme Name: ${ theme }\n*/` );
		}
		mkdirSync( path.join( studioSite(), 'wp-content', 'database' ) );
		const db = new DatabaseSync( path.join( studioSite(), 'wp-content/database/.ht.sqlite' ) );
		db.exec( 'CREATE TABLE wp_options ( option_name TEXT, option_value TEXT )' );
		// What wp_update_themes() stores, from PHP's serialize(): twentytwentyfive
		// from WordPress.org, premium from its Update URI.
		db.prepare( 'INSERT INTO wp_options VALUES ( ?, ? )' ).run(
			'_site_transient_update_themes',
			'O:8:"stdClass":5:{s:12:"last_checked";i:1792685835;s:7:"checked";a:4:{s:16:"twentytwentyfive";s:3:"1.5";s:7:"premium";s:3:"2.0";s:12:"client-theme";s:3:"1.0";s:5:"café";s:1:"1";}s:8:"response";a:1:{s:7:"premium";a:3:{s:5:"theme";s:7:"premium";s:11:"new_version";s:3:"2.1";s:7:"package";s:31:"https://example.com/premium.zip";}}s:9:"no_update";a:1:{s:16:"twentytwentyfive";a:4:{s:5:"theme";s:16:"twentytwentyfive";s:11:"new_version";s:3:"1.5";s:3:"url";s:46:"https://wordpress.org/themes/twentytwentyfive/";s:7:"package";s:62:"https://downloads.wordpress.org/theme/twentytwentyfive.1.5.zip";}}s:12:"translations";a:0:{}}'
		);
		db.close();
		const refusal = ( theme: string ) =>
			getFileWriteRefusal(
				'Edit',
				{ path: `my-site/wp-content/themes/${ theme }/style.css` },
				root,
				isStudioSite
			);

		for ( const updatable of [ 'twentytwentyfive', 'premium' ] ) {
			expect( await refusal( updatable ) ).toContain( `Template: ${ updatable }` );
		}
		// Checked, with no update source, or not checked yet: the user's own themes.
		for ( const own of [ 'client-theme', 'café', 'fresh' ] ) {
			expect( await refusal( own ) ).toBeUndefined();
		}
	} );

	it( 'resolves absolute paths too', async () => {
		const file = path.join( studioSite(), 'wp-includes', 'version.php' );
		expect( await getFileWriteRefusal( 'Edit', { path: file }, '/', isStudioSite ) ).toContain(
			"wp-includes/version.php is this Studio site's copy of WordPress core"
		);
	} );

	it.each( [
		'my-site/wp-config.php',
		// A theme WordPress has no update check for.
		'my-site/wp-content/themes/twentytwentyfive/functions.php',
		'my-site/wp-content/plugins/wp-includes/x.php',
		'my-site/DESIGN.md',
		'elsewhere/wp-includes/functions.php',
		// A WordPress tree that Studio doesn't manage.
		'wordpress-develop/src/wp-includes/functions.php',
		'wordpress-develop/src/wp-admin/includes/file.php',
	] )( 'allows %s', async ( file ) => {
		expect(
			await getFileWriteRefusal( 'Write', { path: file }, root, isStudioSite )
		).toBeUndefined();
	} );

	it( 'only guards Write and Edit', async () => {
		expect(
			await getFileWriteRefusal(
				'Read',
				{ path: 'my-site/wp-includes/functions.php' },
				root,
				isStudioSite
			)
		).toBeUndefined();
	} );

	it( "asks Studio's site list by default", async () => {
		vi.mocked( findSiteByFolder ).mockImplementation( async ( folder ) =>
			arePathsEqual( folder, studioSite() )
				? ( { id: 'site', name: 'My Site', path: studioSite() } as Awaited<
						ReturnType< typeof findSiteByFolder >
				  > )
				: undefined
		);
		expect(
			await getFileWriteRefusal( 'Edit', { path: 'my-site/wp-includes/functions.php' }, root )
		).toContain( 'WordPress core' );
		expect(
			await getFileWriteRefusal(
				'Edit',
				{ path: 'wordpress-develop/src/wp-includes/functions.php' },
				root
			)
		).toBeUndefined();
	} );
} );
