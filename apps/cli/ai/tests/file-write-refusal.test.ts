import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { DatabaseSync } from 'node:sqlite';
import os from 'os';
import path from 'path';
import { arePathsEqual } from '@studio/common/lib/fs-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getWrittenFile } from 'cli/ai/runtimes/pi/tool-safety';
import { getSiteFileWriteRefusal, resolveSiteFile } from 'cli/ai/site-file-guards';
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

// WordPress.org, which has the theme fresh, "Fresh": its update check
// updates fresh unless its Update URI names another host, as api.wordpress.org
// answers.
const updateCheck = vi.fn( async ( url: string, init?: { body: URLSearchParams } ) => {
	if ( url.includes( '/themes/info/' ) ) {
		return Response.json(
			new URL( url ).searchParams.get( 'request[slug]' ) === 'fresh'
				? { name: 'Fresh', version: '2.0' }
				: { error: 'Theme not found' }
		);
	}
	const sent: Record< string, { UpdateURI?: string } > = JSON.parse(
		init?.body.get( 'themes' ) ?? '{}'
	).themes;
	return Response.json( {
		themes: [],
		no_update: Object.fromEntries(
			Object.entries( sent )
				.filter( ( [ theme, { UpdateURI } ] ) => theme === 'fresh' && ! UpdateURI )
				.map( ( [ theme ] ) => [ theme, {} ] )
		),
	} );
} );
vi.stubGlobal( 'fetch', updateCheck );

afterEach( () => {
	rmSync( root, { recursive: true, force: true } );
	vi.mocked( findSiteByFolder ).mockReset();
} );

// What Studio Code's Write and Edit hear before writing: the refusal of the
// file a call writes.
async function getFileWriteRefusal(
	toolName: string,
	params: unknown,
	cwd: string,
	isStudioSite?: ( folder: string ) => Promise< boolean >
) {
	const file = getWrittenFile( toolName, params, cwd );
	const siteFile = file && resolveSiteFile( file );
	return siteFile ? getSiteFileWriteRefusal( siteFile, isStudioSite ) : undefined;
}

describe( 'the file write refusal', () => {
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

	it( 'refuses a theme WordPress updates, by its last update check or WordPress.org, naming where WordPress keeps the change', async () => {
		for ( const theme of [ 'premium', 'client-theme', 'café', 'fresh' ] ) {
			const dir = path.join( studioSite(), 'wp-content', 'themes', theme );
			mkdirSync( dir, { recursive: true } );
			writeFileSync(
				path.join( dir, 'style.css' ),
				`/*\nTheme Name: ${ theme === 'fresh' ? 'Fresh' : theme }\n*/`
			);
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
		const refusal = ( theme: string, file = 'functions.php' ) =>
			getFileWriteRefusal(
				'Edit',
				{ path: `my-site/wp-content/themes/${ theme }/${ file }` },
				root,
				isStudioSite
			);

		// Checked with an update source, or installed since and on WordPress.org.
		for ( const updatable of [ 'twentytwentyfive', 'premium', 'fresh' ] ) {
			expect( await refusal( updatable ) ).toContain( `Template: ${ updatable }` );
			expect( await refusal( updatable, 'style.css' ) ).toContain( "the site's Additional CSS" );
		}
		writeFileSync(
			path.join( studioSite(), 'wp-content/themes/premium/theme.json' ),
			'{"version":3}'
		);
		expect( await refusal( 'premium', 'theme.json' ) ).toContain(
			"Make the change in the site's Global Styles for premium"
		);
		// Checked, with no update source: the user's own themes.
		for ( const own of [ 'client-theme', 'café' ] ) {
			expect( await refusal( own, 'style.css' ) ).toBeUndefined();
		}
	} );

	it.each( [
		{ name: 'no style.css yet, so is no theme WordPress has', header: undefined },
		{ name: 'an Update URI WordPress.org skips', header: 'Theme Name: Fresh\nUpdate URI: false' },
		{ name: "another theme's name", header: 'Theme Name: Fresh Bakery' },
	] )( "allows a theme in WordPress.org's folder name fresh with $name", async ( { header } ) => {
		const dir = path.join( studioSite(), 'wp-content/themes/fresh' );
		mkdirSync( dir, { recursive: true } );
		if ( header ) {
			writeFileSync( path.join( dir, 'style.css' ), `/*\n${ header }\n*/` );
		}
		for ( const file of [ 'style.css', 'functions.php' ] ) {
			expect(
				await getFileWriteRefusal(
					'Write',
					{ path: `my-site/wp-content/themes/fresh/${ file }` },
					root,
					isStudioSite
				)
			).toBeUndefined();
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
		// A theme not checked yet that WordPress.org does not update.
		'my-site/wp-content/themes/client-work/functions.php',
		'my-site/wp-content/plugins/wp-includes/x.php',
		'my-site/README.md',
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
