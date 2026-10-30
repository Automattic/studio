/**
 * Builds the demo site backup the screenshots open on
 * (`screenshots/demo-site/wren-and-barley.zip`) from its source folder:
 * `theme/` (a Twenty Twenty-Five child theme with the site's palette, type and
 * buttons), `images.json` (CC0 photos on Wikimedia Commons) and `content/`
 * (block markup for the pages, posts, templates and template parts).
 * `DESIGN.md` isn't part of the backup: the screenshot script copies it into
 * the site's folder (`design` in `sites.json`).
 *
 * The site is built with the Studio CLI in a throwaway profile, so nothing
 * touches your own Studio: create a site, install the theme, import the
 * photos, create the content, export, delete. Run it after editing the source:
 *
 *   npm run demo-site:build
 *
 * Image placeholders in the markup: {{url:name}}, {{id:name}}, {{alt:name}}.
 */
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEMO_SITE_DIR, readJson, slugify } from './lib/common.mjs';
import { createProfile } from './lib/studio-app.mjs';
import { createSite, runCli, stopSite } from './lib/studio-seed.mjs';

const SOURCE_DIR = path.join( DEMO_SITE_DIR, 'wren-and-barley' );
const CACHE_DIR = path.join( SOURCE_DIR, '.cache' );
const IMAGE_INFO = path.join( CACHE_DIR, 'images.json' );
// Commons serves thumbnails at fixed widths; this one is sharp at the preview's 2x.
const IMAGE_WIDTH = 1920;
const USER_AGENT = 'studio-docs-screenshots/1.0 (https://github.com/Automattic/studio)';
const PAGE_DATE = '2026-09-20 09:00:00';
const THEME = 'wren-and-barley';

// Pages come from content/pages/<slug>.html, posts from content/posts/<slug of title>.html.
const PAGES = [
	{ title: 'Home', slug: 'home' },
	{ title: 'Menu', slug: 'menu' },
	{ title: 'Our story', slug: 'our-story' },
	{ title: 'Visit us', slug: 'visit-us' },
	{ title: 'Order ahead', slug: 'order' },
	{ title: 'Journal', slug: 'journal' },
];
const NAVIGATION = [ 'menu', 'our-story', 'visit-us' ];
const POSTS = [
	{ title: 'Our sourdough story', date: '2026-10-01 08:30:00', image: 'artisan-loaves' },
	{ title: 'Autumn menu is here', date: '2026-10-08 10:15:00', image: 'rustic-treats' },
	{ title: 'Weekend baking classes', date: '2026-10-15 09:00:00', image: 'pastry-tray' },
];
const OPTIONS = {
	blogname: 'Wren & Barley',
	blogdescription: 'Bakery and café on Mill Lane',
	timezone_string: 'UTC',
	date_format: 'F j, Y',
	permalink_structure: '/%postname%/',
	uploads_use_yearmonth_folders: '0',
	show_on_front: 'page',
};

/**
 * Resolves each photo's Commons thumbnail URL and checks its license, once:
 * the answers are kept with the downloads, so a rebuild works offline.
 */
async function resolveImages( images ) {
	const known = await readJson( IMAGE_INFO ).catch( () => ( {} ) );
	if ( images.every( ( image ) => known[ image.file ] ) ) {
		return images.map( ( image ) => ( { ...image, ...known[ image.file ] } ) );
	}
	const params = new URLSearchParams( {
		action: 'query',
		format: 'json',
		titles: images.map( ( image ) => image.file ).join( '|' ),
		prop: 'imageinfo',
		iiprop: 'url|extmetadata',
		iiurlwidth: String( IMAGE_WIDTH ),
	} );
	const response = await fetch( `https://commons.wikimedia.org/w/api.php?${ params }`, {
		headers: { 'User-Agent': USER_AGENT },
	} );
	if ( ! response.ok ) {
		throw new Error( `Wikimedia Commons API responded ${ response.status }` );
	}
	const pages = Object.values( ( await response.json() ).query.pages );
	const resolved = images.map( ( image ) => {
		const page = pages.find( ( p ) => p.title === image.file );
		const info = page?.imageinfo?.[ 0 ];
		if ( ! info ) {
			throw new Error( `${ image.file } not found on Wikimedia Commons` );
		}
		const license = info.extmetadata?.LicenseShortName?.value;
		if ( license !== 'CC0' ) {
			throw new Error( `${ image.file } is licensed ${ license }, not CC0; choose another photo` );
		}
		return { ...image, source: info.descriptionurl, download: info.thumburl };
	} );
	await mkdir( CACHE_DIR, { recursive: true } );
	await writeFile(
		IMAGE_INFO,
		JSON.stringify(
			Object.fromEntries(
				resolved.map( ( i ) => [ i.file, { source: i.source, download: i.download } ] )
			),
			null,
			2
		)
	);
	return resolved;
}

async function downloadImages( images ) {
	await mkdir( CACHE_DIR, { recursive: true } );
	await Promise.all(
		images.map( async ( image ) => {
			image.path = path.join( CACHE_DIR, `${ image.name }.jpg` );
			if ( existsSync( image.path ) ) {
				return;
			}
			console.log( `  downloading ${ image.file }` );
			const response = await fetch( image.download, { headers: { 'User-Agent': USER_AGENT } } );
			if ( ! response.ok ) {
				throw new Error( `Downloading ${ image.file } failed: ${ response.status }` );
			}
			await writeFile( image.path, Buffer.from( await response.arrayBuffer() ) );
		} )
	);
}

function fillPlaceholders( markup, images ) {
	return markup.replace( /\{\{(url|id|alt):([\w-]+)\}\}/g, ( match, field, name ) => {
		const image = images.find( ( i ) => i.name === name );
		if ( ! image ) {
			throw new Error( `Unknown image "${ name }" in ${ match }` );
		}
		return String( image[ field ] );
	} );
}

async function main() {
	const site = ( await readJson( path.join( DEMO_SITE_DIR, 'sites.json' ) ) ).find(
		( s ) => s.import
	);
	const backup = path.join( DEMO_SITE_DIR, site.import );
	const images = await resolveImages( await readJson( path.join( SOURCE_DIR, 'images.json' ) ) );
	console.log( 'Fetching photos...' );
	await downloadImages( images );

	console.log( 'Creating the site...' );
	const profile = await createProfile();
	let sitePath;
	const work = path.join( profile.dirs.root, 'build' );
	await mkdir( work );
	const wp = async ( ...args ) =>
		( await runCli( profile, [ 'wp', '--path', sitePath, ...args, '--user=admin' ] ) ).trim();
	const createPost = async ( type, markup, fields ) => {
		const file = path.join( work, `${ type }.html` );
		await writeFile( file, markup );
		return wp(
			'post',
			'create',
			file,
			`--post_type=${ type }`,
			'--post_status=publish',
			'--porcelain',
			...fields
		);
	};

	try {
		sitePath = await createSite( profile, { ...site, start: true } );

		console.log( 'Configuring the site...' );
		for ( const [ name, value ] of Object.entries( OPTIONS ) ) {
			await wp( 'option', 'update', name, value );
		}
		await wp( 'rewrite', 'flush' );
		await wp( 'post', 'delete', '1', '2', '--force' );
		await wp( 'user', 'update', 'admin', '--display_name=Ana Oakes', '--skip-email' );
		await wp( 'term', 'update', 'category', '1', '--name=Bakery notes', '--slug=bakery-notes' );
		// The child theme carries the palette, type and buttons (`theme/theme.json`).
		await cp( path.join( SOURCE_DIR, 'theme' ), path.join( sitePath, 'wp-content/themes', THEME ), {
			recursive: true,
		} );
		await wp( 'theme', 'activate', THEME );
		// Only the originals are needed, and only the uploads are exported.
		await writeFile(
			path.join( sitePath, 'wp-content/mu-plugins/docs-demo-build.php' ),
			`<?php
add_filter( 'intermediate_image_sizes_advanced', '__return_empty_array' );
add_filter( 'big_image_size_threshold', '__return_false' );
`
		);

		console.log( 'Importing photos...' );
		for ( const image of images ) {
			image.id = Number(
				await wp(
					'media',
					'import',
					image.path,
					`--title=${ image.name.replace( /-/g, ' ' ) }`,
					`--alt=${ image.alt }`,
					'--porcelain'
				)
			);
			// Uploads keep their file name, in one folder (`uploads_use_yearmonth_folders`).
			image.url = `/wp-content/uploads/${ path.basename( image.path ) }`;
		}

		console.log( 'Creating the content...' );
		const pageIds = {};
		for ( const [ index, page ] of PAGES.entries() ) {
			const markup = fillPlaceholders(
				await readFile( path.join( SOURCE_DIR, 'content/pages', `${ page.slug }.html` ), 'utf8' ),
				images
			);
			pageIds[ page.slug ] = await createPost( 'page', markup, [
				`--post_title=${ page.title }`,
				`--post_name=${ page.slug }`,
				`--post_date=${ PAGE_DATE }`,
				`--menu_order=${ index }`,
			] );
		}
		await wp( 'option', 'update', 'page_on_front', pageIds.home );
		await wp( 'option', 'update', 'page_for_posts', pageIds.journal );
		for ( const post of POSTS ) {
			const markup = fillPlaceholders(
				await readFile(
					path.join( SOURCE_DIR, 'content/posts', `${ slugify( post.title ) }.html` ),
					'utf8'
				),
				images
			);
			const image = images.find( ( i ) => i.name === post.image );
			await createPost( 'post', markup, [
				`--post_title=${ post.title }`,
				`--post_date=${ post.date }`,
				'--comment_status=closed',
				`--meta_input={"_thumbnail_id":${ image.id }}`,
			] );
		}
		// The header's Navigation block falls back to the newest menu.
		const links = NAVIGATION.map( ( slug ) => {
			const page = PAGES.find( ( p ) => p.slug === slug );
			return `<!-- wp:navigation-link {"label":"${ page.title }","type":"page","id":${ pageIds[ slug ] },"url":"/${ slug }/","kind":"post-type"} /-->`;
		} );
		await createPost( 'wp_navigation', links.join( '\n' ), [ '--post_title=Main menu' ] );
		// The front page (no title) and the Journal (posts page) use their own
		// templates instead of the theme's; the header (Order button) and footer
		// their own template parts.
		const overrides = [
			[ 'wp_template', 'templates/front-page.html', 'front-page', 'Front page' ],
			[ 'wp_template', 'templates/home.html', 'home', 'Journal' ],
			[ 'wp_template_part', 'parts/header.html', 'header', 'Header' ],
			[ 'wp_template_part', 'parts/footer.html', 'footer', 'Footer' ],
		];
		for ( const [ type, file, slug, title ] of overrides ) {
			const markup = await readFile( path.join( SOURCE_DIR, 'content', file ), 'utf8' );
			const id = await createPost( type, markup, [
				`--post_title=${ title }`,
				`--post_name=${ slug }`,
			] );
			await wp( 'post', 'term', 'set', id, 'wp_theme', THEME );
			if ( type === 'wp_template_part' ) {
				await wp( 'post', 'term', 'set', id, 'wp_template_part_area', slug );
			}
		}

		// Every Studio site ships the parent theme and plugins; the backup only
		// needs the database, the photos and the child theme.
		console.log( 'Exporting...' );
		await rm( backup, { force: true } );
		await runCli( profile, [
			'export',
			backup,
			'--path',
			sitePath,
			'--include-only',
			'uploads',
			`themes/${ THEME }`,
		] );
	} finally {
		if ( sitePath ) {
			await stopSite( profile, sitePath ).catch( () => {} );
		}
		await profile.remove();
	}

	const credits = images.map(
		( image ) => `  ${ image.name }: ${ image.author } (CC0) ${ image.source }`
	);
	console.log(
		`\nWrote ${ path.relative( process.cwd(), backup ) } (${ (
			( await stat( backup ) ).size /
			1024 /
			1024
		).toFixed( 1 ) } MB)`
	);
	console.log( `Photos:\n${ credits.join( '\n' ) }` );
}

await main();
