import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { DatabaseSync } from 'node:sqlite';
import os from 'os';
import path from 'path';
import { arePathsEqual } from '@studio/common/lib/fs-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getWrittenFile, getWrittenText } from '@studio/agent/node/runtime/tool-safety';
import { getSiteFileWriteRefusal, resolveSiteFile } from '@studio/agent/node/site-file-guards';
import { createSiteNotes } from '@studio/agent/node/site-notes';
import { createFakeHost, fakeSite } from '@studio/agent/node/tests/fake-host';

let root: string;
const studioSite = () => path.join( root, 'my-site' );
const unmanaged = () => path.join( root, 'wordpress-develop', 'src' );
const isStudioSite = async ( folder: string ) => arePathsEqual( folder, studioSite() );

// A host whose Studio sites are the folders `isStudioSite` names, if any.
function hostOf( studio?: ( folder: string ) => Promise< boolean > ) {
	const host = createFakeHost( root );
	host.sites.findByFolder = async ( folder ) =>
		( await studio?.( folder ) ) ? { ...fakeSite, path: folder } : undefined;
	return host;
}

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
	return siteFile ? getSiteFileWriteRefusal( hostOf( isStudioSite ), siteFile ) : undefined;
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
			// A child theme first, whatever the change; only one it alone holds names no other place.
			expect( await refusal( updatable ) ).toMatch(
				new RegExp(
					`Make the change in a child theme of ${ updatable }, which create_child_theme makes and activates; .* over ${ updatable }'s\\.$`
				)
			);
			expect( await refusal( updatable, 'style.css' ) ).toContain(
				". Or make it in the site's Additional CSS"
			);
		}
		writeFileSync(
			path.join( studioSite(), 'wp-content/themes/premium/theme.json' ),
			'{"version":3}'
		);
		expect( await refusal( 'premium', 'theme.json' ) ).toContain(
			". Or make it in the site's Global Styles for premium"
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
} );

describe( "PHP in a block theme's templates", () => {
	const theme = 'my-site/wp-content/themes/twentytwentyfive';
	const php = '<img src="<?php echo esc_url( get_template_directory_uri() ); ?>/logo.png"/>';
	it.each< [ string, string, unknown, string | undefined ] >( [
		[ 'Write', `${ theme }/templates/home.html`, { content: php }, 'template,' ],
		[
			'Edit',
			`${ theme }/parts/header.html`,
			{
				edits: [
					{ oldText: 'a', newText: 'b' },
					{ oldText: 'c', newText: '<?= $logo ?>' },
				],
			},
			'template part,',
		],
		[ 'Write', `${ theme }/templates/home.html`, { content: '<!-- wp:paragraph /-->' }, undefined ],
		[
			'Edit',
			`${ theme }/templates/home.html`,
			{ edits: [ { oldText: php, newText: '' } ] },
			undefined,
		],
		[ 'Write', `${ theme }/patterns/hero.php`, { content: php }, undefined ],
		[ 'Write', `${ theme }/functions.php`, { content: php }, undefined ],
		[ 'Write', 'my-site/wp-content/plugins/shop/templates/a.html', { content: php }, undefined ],
	] )( '%s %s', async ( toolName, file, params, refused ) => {
		const refusal = await createSiteNotes( hostOf() ).beforeWrite(
			getWrittenFile( toolName, { path: file, ...( params as object ) }, root ) ?? '',
			getWrittenText( toolName, params )
		);
		if ( refused ) {
			expect( refusal ).toContain( `block theme's ${ refused }` );
			expect( refusal ).toContain(
				`${ path.join(
					root,
					theme,
					'patterns',
					'<name>.php'
				) } with a "Slug: twentytwentyfive/<name>" header`
			);
		} else {
			expect( refusal ).toBeUndefined();
		}
	} );
} );

describe( 'a template part written inside templates/', () => {
	const theme = 'my-site/wp-content/themes/twentytwentyfive';
	it.each< [ string, string | undefined ] >( [
		[ 'templates/parts/header.html', 'parts/header.html' ],
		[ 'templates/parts/footer/dark.html', 'parts/footer/dark.html' ],
		// A custom template theme.json can name by its path.
		[ 'templates/landing/home.html', undefined ],
		[ 'templates/home.html', undefined ],
		[ 'parts/header.html', undefined ],
		[ 'templates/parts/notes.txt', undefined ],
	] )( '%s', async ( file, belongs ) => {
		const refusal = await createSiteNotes( hostOf() ).beforeWrite(
			path.join( root, theme, file ),
			''
		);
		if ( belongs ) {
			expect( refusal ).toContain( `Write it to ${ path.join( root, theme, belongs ) }.` );
		} else {
			expect( refusal ).toBeUndefined();
		}
	} );
} );

describe( 'what Studio changed in a file after a write', () => {
	it.each< [ string, string | undefined, string[] ] >( [
		[
			'the file as the tool left it',
			'Hours: 9-5\nOpen daily',
			[ 'lines 2-2 now read:\n~~~\nClosed Mondays\n~~~' ],
		],
		// Unknown: what the file holds when the notes start is what the agent left.
		[ 'nothing known', undefined, [] ],
	] )( 'compared with %s', async ( _known, left, said ) => {
		const file = path.join( studioSite(), 'wp-content/plugins/shop/readme.txt' );
		mkdirSync( path.dirname( file ), { recursive: true } );
		writeFileSync( file, 'Hours: 9-5\nClosed Mondays' );

		const notes = ( await createSiteNotes( hostOf() ).afterWrite( file, left ) ).filter( ( note ) =>
			note.startsWith( 'Studio changed' )
		);

		expect( notes.map( ( note ) => note.slice( note.indexOf( 'lines' ) ) ) ).toEqual( said );
	} );
} );
