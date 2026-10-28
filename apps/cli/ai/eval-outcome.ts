/**
 * What a turn left behind, captured after it ends so eval assertions judge
 * the outcome a user would get rather than the tool calls that produced it.
 *
 * For each site the turn created, and the seeded active site, the capture
 * records the WordPress state (theme, plugins, published content as parsed
 * blocks, registered block styles, global styles), the rendered home page,
 * block validity in the site's own editor, the active theme's files, the
 * code (themes, plugins, mu-plugins) the turn added or changed on the active
 * site, and whether an installed parent theme still matches its WordPress.org
 * release.
 * Sites that existed before the turn are compared by their database and
 * wp-content modification times, so a change to an unrelated site shows up.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { captureScreenshotBuffer } from '@studio/agent/node';
import { validateBlocks } from '@studio/agent/node/block-validator';
import { getSharedBrowser } from '@studio/agent/node/browser-utils';
import { STUDIO_LOADER_MU_PLUGIN_FILENAME } from '@studio/common/lib/mu-plugins';
import { runCommand as runStartSiteCommand } from 'cli/commands/site/start';
import { Mode as StopMode, runCommand as runStopSiteCommand } from 'cli/commands/site/stop';
import { readCliConfig } from 'cli/lib/cli-config/core';
import { getSiteByFolder, getSiteUrl } from 'cli/lib/cli-config/sites';
import { connectToDaemon } from 'cli/lib/daemon-client';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import { Logger } from 'cli/logger';

const execFileAsync = promisify( execFile );

export interface SiteFingerprint {
	path: string;
	name: string;
	mtimeMs: number;
	// Content hashes of the site's code (themes, plugins, mu-plugins), keyed by
	// path relative to wp-content, so the files a turn adds or changes show up.
	code: Record< string, string >;
}

// The newest modification time under a site's database and wp-content, which
// moves whenever the site is changed. A read of the SQLite database moves its
// -shm file, the WAL index, which holds none of the site
// (https://sqlite.org/walformat.html). Studio's loader mu-plugin, which Studio
// writes into each site it runs and leaves out of archives and exports, is
// not the site's either, nor is the mu-plugins folder's own time, which its
// rewrite moves; the code hashes tell a mu-plugin the turn added or removed.
const STUDIO_LOADER = path.join( 'mu-plugins', STUDIO_LOADER_MU_PLUGIN_FILENAME );

function newestMtime( dir: string, depth = 6 ): number {
	let newest = 0;
	const loader = path.join( dir, 'wp-content', STUDIO_LOADER );
	const muPlugins = path.dirname( loader );
	const walk = ( current: string, level: number ) => {
		let entries;
		try {
			entries = readdirSync( current, { withFileTypes: true } );
		} catch {
			return;
		}
		for ( const entry of entries ) {
			if ( [ 'node_modules', 'cache' ].includes( entry.name ) || entry.name.endsWith( '-shm' ) )
				continue;
			const full = path.join( current, entry.name );
			if ( full === loader ) continue;
			try {
				const stat = statSync( full );
				// SQLite's WAL files: a read-only read creates the WAL index (-shm)
				// and an empty WAL, and cannot remove them, so it changes the
				// database folder; a write adds frames to the WAL or, on the last
				// close, checkpoints them into the database
				// (https://sqlite.org/walformat.html).
				const readOnlyTrace =
					( level === 0 && entry.name === 'database' ) ||
					( entry.name.endsWith( '-wal' ) && ! stat.size );
				if ( ! readOnlyTrace && full !== muPlugins ) newest = Math.max( newest, stat.mtimeMs );
			} catch {
				continue;
			}
			if ( entry.isDirectory() && level < depth ) walk( full, level + 1 );
		}
	};
	walk( path.join( dir, 'wp-content' ), 0 );
	return newest;
}

export async function fingerprintSites(): Promise< SiteFingerprint[] > {
	const { sites } = await readCliConfig();
	return sites
		.filter( ( site ) => existsSync( site.path ) )
		.map( ( site ) => ( {
			path: site.path,
			name: site.name,
			mtimeMs: newestMtime( site.path ),
			code: hashCode( site.path ),
		} ) );
}

const PROBE_PHP = String.raw`
$count = function ( $blocks, &$acc ) use ( &$count ) {
	foreach ( $blocks as $block ) {
		if ( $block['blockName'] ) { $acc[ $block['blockName'] ] = ( $acc[ $block['blockName'] ] ?? 0 ) + 1; }
		$count( $block['innerBlocks'], $acc );
	}
};
$front = (int) get_option( 'page_on_front' );
$content = array();
foreach ( get_posts( array( 'post_type' => array( 'page', 'post', 'wp_template', 'wp_template_part', 'wp_navigation', 'wp_block' ), 'post_status' => 'publish', 'numberposts' => -1 ) ) as $post ) {
	$blocks = array();
	$count( parse_blocks( $post->post_content ), $blocks );
	$content[] = array( 'id' => $post->ID, 'type' => $post->post_type, 'slug' => $post->post_name, 'title' => $post->post_title, 'renderedTitle' => get_the_title( $post ), 'link' => get_permalink( $post ), 'categories' => 'post' === $post->post_type ? wp_get_post_categories( $post->ID, array( 'fields' => 'names' ) ) : array(), 'isFront' => $post->ID === $front, 'blocks' => $blocks, 'content' => $post->post_content );
}
$block_types = array();
foreach ( WP_Block_Type_Registry::get_instance()->get_all_registered() as $name => $type ) {
	if ( str_starts_with( $name, 'core/' ) ) { continue; }
	$sources = array();
	foreach ( (array) $type->editor_script_handles as $handle ) { $sources[] = wp_scripts()->registered[ $handle ]->src ?? $handle; }
	$block_types[] = array( 'name' => $name, 'editorScripts' => $sources );
}
// Reading the theme's data registers the block styles of its styles/blocks/*.json
// files (WP_Theme_JSON_Resolver::get_theme_data), so it comes first.
$merged = WP_Theme_JSON_Resolver::get_merged_data()->get_raw_data();
$styles = array();
foreach ( WP_Block_Styles_Registry::get_instance()->get_all_registered() as $block => $variations ) {
	$styles[ $block ] = array_keys( $variations );
}
$palette = array();
foreach ( (array) ( $merged['settings']['color']['palette'] ?? array() ) as $entries ) {
	foreach ( (array) $entries as $entry ) { $palette[] = $entry; }
}
$plugins = array();
foreach ( (array) get_option( 'active_plugins' ) as $plugin ) { $plugins[] = dirname( $plugin ) === '.' ? basename( $plugin, '.php' ) : dirname( $plugin ); }
echo 'OUTCOME_JSON=' . wp_json_encode( array(
	'theme' => array( 'stylesheet' => get_stylesheet(), 'template' => get_template(), 'isBlockTheme' => wp_is_block_theme(), 'stylesheetVersion' => wp_get_theme()->get( 'Version' ), 'templateVersion' => wp_get_theme( get_template() )->get( 'Version' ) ),
	'plugins' => $plugins,
	'showOnFront' => get_option( 'show_on_front' ),
	'content' => $content,
	'products' => function_exists( 'wc_get_products' ) ? array_map( function ( $product ) { return array( 'name' => $product->get_name(), 'price' => $product->get_price(), 'purchasable' => $product->is_purchasable(), 'visible' => $product->is_visible() ); }, wc_get_products( array( 'status' => 'publish', 'limit' => -1 ) ) ) : array(),
	'shopPage' => function_exists( 'wc_get_page_id' ) ? get_post_status( wc_get_page_id( 'shop' ) ) : null,
	'blockStyles' => $styles,
	'blockTypes' => $block_types,
	'palette' => $palette,
	'mergedStyles' => $merged['styles'] ?? array(),
	'userGlobalStyles' => WP_Theme_JSON_Resolver::get_user_data()->get_raw_data(),
	'customCss' => wp_get_custom_css(),
) ) . "\n";
`;

async function wp( sitePath: string, args: string[] ): Promise< string > {
	const site = await getSiteByFolder( sitePath );
	await using command = await runWpCliCommand( site, args );
	const exitCode = await command.response.exitCode;
	const stdout = await command.response.stdoutText;
	if ( exitCode !== 0 ) {
		throw new Error(
			`wp ${ args[ 0 ] } exited ${ exitCode }: ${ await command.response.stderrText }`
		);
	}
	return stdout;
}

const TEXT_FILE = /\.(css|json|html|php|md|txt)$/;

function hashFiles( dir: string ): Record< string, string > {
	const hashes: Record< string, string > = {};
	const walk = ( current: string ) => {
		for ( const entry of readdirSync( current, { withFileTypes: true } ) ) {
			const full = path.join( current, entry.name );
			if ( entry.isDirectory() ) walk( full );
			else
				hashes[ path.relative( dir, full ) ] = createHash( 'sha1' )
					.update( readFileSync( full ) )
					.digest( 'hex' );
		}
	};
	if ( existsSync( dir ) ) walk( dir );
	return hashes;
}

const CODE_DIRS = [ 'themes', 'plugins', 'mu-plugins' ];
const CODE_TEXT_FILE = /\.(css|json|html|php|js|mjs|ts|tsx|jsx|md|txt)$/;

function hashCode( sitePath: string ): Record< string, string > {
	const hashes: Record< string, string > = {};
	for ( const dir of CODE_DIRS ) {
		for ( const [ file, hash ] of Object.entries(
			hashFiles( path.join( sitePath, 'wp-content', dir ) )
		) ) {
			if ( path.join( dir, file ) !== STUDIO_LOADER ) hashes[ `${ dir }/${ file }` ] = hash;
		}
	}
	return hashes;
}

interface CodeChange {
	file: string;
	status: 'added' | 'changed' | 'removed';
	text?: string;
}

// The code files (relative to wp-content) a turn added, changed or removed,
// with the text of the added and changed ones.
function diffCode(
	sitePath: string,
	before: Record< string, string >,
	after: Record< string, string >
): CodeChange[] {
	const changes: CodeChange[] = [];
	for ( const file of [
		...new Set( [ ...Object.keys( before ), ...Object.keys( after ) ] ),
	].sort() ) {
		if ( before[ file ] === after[ file ] ) continue;
		const status = ! after[ file ] ? 'removed' : ! before[ file ] ? 'added' : 'changed';
		const change: CodeChange = { file, status };
		if ( status !== 'removed' && CODE_TEXT_FILE.test( file ) ) {
			try {
				const text = readFileSync( path.join( sitePath, 'wp-content', file ), 'utf8' );
				if ( text.length < 200_000 ) change.text = text;
			} catch {
				// Removed after the hashes were taken.
			}
		}
		changes.push( change );
	}
	return changes;
}

function readThemeText( dir: string ): Record< string, string > {
	const files: Record< string, string > = {};
	for ( const relative of Object.keys( hashFiles( dir ) ) ) {
		if ( TEXT_FILE.test( relative ) && ! relative.includes( 'node_modules' ) ) {
			const text = readFileSync( path.join( dir, relative ), 'utf8' );
			if ( text.length < 200_000 ) files[ relative ] = text;
		}
	}
	return files;
}

// Files of an installed theme that differ from its WordPress.org release, or
// null when the release cannot be fetched (not a WordPress.org theme).
async function changedFromRelease(
	themeDir: string,
	slug: string,
	version: string
): Promise< string[] | null > {
	const tmp = mkdtempSync( path.join( os.tmpdir(), 'eval-theme-' ) );
	try {
		const response = await fetch(
			`https://downloads.wordpress.org/theme/${ slug }.${ version }.zip`
		);
		if ( ! response.ok ) return null;
		const zip = path.join( tmp, 'theme.zip' );
		writeFileSync( zip, Buffer.from( await response.arrayBuffer() ) );
		await execFileAsync( 'unzip', [ '-q', zip, '-d', tmp ] );
		const release = hashFiles( path.join( tmp, slug ) );
		const installed = hashFiles( themeDir );
		return [ ...new Set( [ ...Object.keys( release ), ...Object.keys( installed ) ] ) ]
			.filter( ( file ) => release[ file ] !== installed[ file ] )
			.sort();
	} catch {
		return null;
	} finally {
		await rm( tmp, { recursive: true, force: true } );
	}
}

// The format a theme screenshot really is, from its leading bytes.
function imageFormat( file: string ): string | null {
	if ( ! existsSync( file ) ) return null;
	const head = readFileSync( file ).subarray( 0, 4 );
	if ( head[ 0 ] === 0xff && head[ 1 ] === 0xd8 && head[ 2 ] === 0xff )
		return `jpeg:${ path.basename( file ) }`;
	if ( head.toString( 'hex' ) === '89504e47' ) return `png:${ path.basename( file ) }`;
	return `unknown:${ path.basename( file ) }`;
}

async function renderHome( url: string ) {
	try {
		const response = await fetch( url, { redirect: 'follow' } );
		const html = await response.text();
		// Each image's address, and the status the site answers it with (null
		// for images from another origin, which are not requested).
		const images = await Promise.all(
			[ ...html.matchAll( /<img\b[^>]*\bsrc="([^"]+)"/g ) ].map( async ( m ) => {
				const src = new URL( m[ 1 ].replace( /&amp;/g, '&' ), url );
				const sameOrigin = src.origin === new URL( url ).origin;
				const status = sameOrigin
					? await fetch( src, { method: 'HEAD' } ).then(
							( r ) => r.status,
							() => 0
					  )
					: null;
				return { src: src.href, status };
			} )
		);
		const nav = [ ...html.matchAll( /<nav\b[\s\S]*?<\/nav>/g ) ]
			.map( ( m ) => m[ 0 ] )
			.join( '\n' );
		const navHrefs = [ ...nav.matchAll( /<a\b[^>]*\bhref="([^"]*)"/g ) ].map( ( m ) => m[ 1 ] );
		// Where each of the site's own navigation links leads.
		const navTargets: Record< string, { status: number; url: string } > = {};
		for ( const href of new Set( navHrefs ) ) {
			const target = new URL( href.replace( /&#0?38;|&amp;/g, '&' ), url );
			target.hash = '';
			if ( target.origin !== new URL( url ).origin ) continue;
			const page = await fetch( target, { redirect: 'follow' } ).catch( () => undefined );
			navTargets[ href ] = { status: page?.status ?? 0, url: page?.url ?? target.href };
		}
		return {
			status: response.status,
			html,
			phpErrors: [
				...html.matchAll( /<b>(Fatal error|Parse error|Warning|Notice|Deprecated)<\/b>:[^<]*/g ),
			].map( ( m ) => m[ 0 ].replace( /<\/?b>/g, '' ) ),
			navHrefs,
			navTargets,
			images,
			ids: [ ...html.matchAll( /\bid="([^"]+)"/g ) ].map( ( m ) => m[ 1 ] ),
		};
	} catch ( error ) {
		return { status: 0, error: error instanceof Error ? error.message : String( error ) };
	}
}

/**
 * The home page's image frames: each element holding several images, with how
 * many it shows at once. Measured in a browser as tall as the page, so every
 * image is in view: an image is shown when its center is inside every
 * ancestor that clips it and nothing in its chain is transparent or hidden,
 * so slides faded out or slid out of a clipped frame, as slideshows and
 * carousels hold them, are not.
 */
// Each published page's forms that take a message (a textarea), filled in and
// sent the way a visitor would, then where WordPress stored the message: the
// post types and meta keys whose rows now hold its marker. Comment forms are
// left alone; they are core's, not the page's.
// What a visitor types into each kind of field.
const VISITOR: Record< string, string > = {
	text: 'Eval Visitor',
	email: 'visitor@example.com',
	url: 'https://example.com',
	tel: '5555550100',
	number: '1',
};

async function sendPageForms( sitePath: string, links: string[] ) {
	const sent: Array< { page: string; marker: string; afterText: string; error?: string } > = [];
	const browser = await getSharedBrowser();
	for ( const link of links ) {
		const page = await browser.newPage( { viewport: { width: 1280, height: 900 } } );
		const marker = `studio-eval-message-${ sent.length + 1 }-${ Date.now() }`;
		try {
			await page.goto( link, { waitUntil: 'load', timeout: 30000 } );
			const form = page.locator( 'form:has(textarea):not([action*="wp-comments-post"])' ).first();
			if ( ! ( await form.count() ) ) continue;
			await form.locator( 'textarea:visible' ).first().fill( marker );
			for ( const field of await form.locator( 'input:visible' ).all() ) {
				const type = ( await field.getAttribute( 'type' ) ) ?? 'text';
				if ( type === 'checkbox' || type === 'radio' ) {
					await field.check().catch( () => undefined );
				} else if ( type in VISITOR ) {
					await field.fill( VISITOR[ type ] );
				}
			}
			await form
				.locator( 'button[type="submit"], input[type="submit"], button:not([type])' )
				.first()
				.click();
			await page.waitForLoadState( 'load' ).catch( () => undefined );
			await page.waitForTimeout( 3000 );
			sent.push( {
				page: link,
				marker,
				afterText: ( await page.innerText( 'body' ) ).slice( 0, 2000 ),
			} );
		} catch ( error ) {
			sent.push( {
				page: link,
				marker,
				afterText: '',
				error: error instanceof Error ? error.message : String( error ),
			} );
		} finally {
			await page.close();
		}
	}
	return Promise.all(
		sent.map( async ( entry ) => {
			const found = await wp( sitePath, [
				'eval',
				`global $wpdb; $like = '%' . $wpdb->esc_like( ${ JSON.stringify( entry.marker ) } ) . '%';
echo 'STORED_JSON=' . wp_json_encode( array(
	'postTypes' => $wpdb->get_col( $wpdb->prepare( "SELECT DISTINCT post_type FROM {$wpdb->posts} WHERE post_content LIKE %s OR post_title LIKE %s OR post_excerpt LIKE %s", $like, $like, $like ) ),
	'metaKeys' => $wpdb->get_col( $wpdb->prepare( "SELECT DISTINCT meta_key FROM {$wpdb->postmeta} WHERE meta_value LIKE %s", $like ) ),
	'optionNames' => $wpdb->get_col( $wpdb->prepare( "SELECT option_name FROM {$wpdb->options} WHERE option_value LIKE %s", $like ) ),
) ) . "\\n";`,
			] ).catch( ( error ) => `STORED_JSON=${ JSON.stringify( { error: String( error ) } ) }` );
			const stored = found.match( /STORED_JSON=(.*)/ );
			return { ...entry, stored: stored ? JSON.parse( stored[ 1 ] ) : null };
		} )
	);
}

/**
 * Saves the home page, top to bottom, as a visitor's 1280x900 window shows
 * it, through take_screenshot's capture: the window keeps its height, so a
 * section as tall as the window is as tall as a visitor sees it.
 */
export async function saveHomeScreenshot( url: string, file: string ): Promise< boolean > {
	try {
		const capture = await captureScreenshotBuffer(
			url,
			{ width: 1280, height: 900 },
			{ fullPage: true, format: 'jpeg' }
		);
		writeFileSync( file, capture.buffer );
		return true;
	} catch {
		return false;
	}
}

async function homeImageFrames( url: string ) {
	try {
		const browser = await getSharedBrowser();
		const page = await browser.newPage( { viewport: { width: 1280, height: 900 } } );
		try {
			await page.goto( url, { waitUntil: 'load', timeout: 30000 } );
			const height = await page.evaluate( () => document.documentElement.scrollHeight );
			await page.setViewportSize( {
				width: 1280,
				height: Math.min( Math.max( height, 900 ), 8000 ),
			} );
			await page.waitForTimeout( 1500 );
			return await page.evaluate( () => {
				const images = [ ...document.querySelectorAll( 'img' ) ];
				// Shown: its center inside every ancestor that clips it, and
				// nothing in its chain transparent or hidden.
				const shown = ( img: HTMLImageElement ) => {
					const box = img.getBoundingClientRect();
					if ( ! box.width || ! box.height ) return false;
					const x = box.x + box.width / 2;
					const y = box.y + box.height / 2;
					if ( getComputedStyle( img ).visibility === 'hidden' ) return false;
					for ( let el: Element | null = img; el; el = el.parentElement ) {
						const style = getComputedStyle( el );
						if ( Number( style.opacity ) === 0 ) return false;
						if (
							el !== img &&
							( style.overflowX !== 'visible' || style.overflowY !== 'visible' )
						) {
							const clip = el.getBoundingClientRect();
							if ( x < clip.left || x > clip.right || y < clip.top || y > clip.bottom )
								return false;
						}
					}
					return true;
				};
				const frames = new Map< Element, { images: number; shown: number } >();
				for ( const img of images ) {
					let frame = img.parentElement;
					while ( frame && frame.querySelectorAll( 'img' ).length < 3 ) frame = frame.parentElement;
					if ( ! frame || frame === document.body ) continue;
					const entry = frames.get( frame ) ?? { images: 0, shown: 0 };
					entry.images++;
					entry.shown += shown( img ) ? 1 : 0;
					frames.set( frame, entry );
				}
				return [ ...frames ].map( ( [ el, entry ] ) => {
					const box = el.getBoundingClientRect();
					return {
						element: `${ el.tagName.toLowerCase() }.${ [ ...el.classList ].join( '.' ) }`,
						width: Math.round( box.width ),
						height: Math.round( box.height ),
						...entry,
					};
				} );
			} );
		} finally {
			await page.close();
		}
	} catch ( error ) {
		return { error: error instanceof Error ? error.message : String( error ) };
	}
}

interface SiteOutcome {
	name: string;
	path: string;
	created: boolean;
	url?: string;
	error?: string;
	[ key: string ]: unknown;
}

async function captureSiteOutcome(
	sitePath: string,
	created: boolean,
	artifactDir: string,
	code?: { before: Record< string, string >; after: Record< string, string > }
): Promise< SiteOutcome > {
	const site = await getSiteByFolder( sitePath );
	const outcome: SiteOutcome = { name: site.name, path: sitePath, created };
	// Code files the turn added, changed or removed (null for sites it created).
	outcome.codeChanges = code ? diffCode( sitePath, code.before, code.after ) : null;
	try {
		await connectToDaemon();
		await runStartSiteCommand( sitePath, true, true, new Logger() );
		const url = getSiteUrl( site );
		outcome.url = url;

		const probe = ( await wp( sitePath, [ 'eval', PROBE_PHP ] ) ).match( /OUTCOME_JSON=(.*)/ );
		if ( ! probe ) throw new Error( 'the WordPress probe printed no state' );
		const state = JSON.parse( probe[ 1 ] );
		Object.assign( outcome, state );

		const themes = path.join( sitePath, 'wp-content', 'themes' );
		const { stylesheet, stylesheetVersion, template, templateVersion } = state.theme;
		const themeDir = path.join( themes, stylesheet );
		outcome.themeFiles = readThemeText( themeDir );
		outcome.themeFileList = Object.keys( hashFiles( themeDir ) ).sort();
		outcome.themeScreenshot =
			imageFormat( path.join( themeDir, 'screenshot.jpg' ) ) ??
			imageFormat( path.join( themeDir, 'screenshot.png' ) );
		// Files changed from the WordPress.org release (null for themes not from there).
		outcome.themeChanges = await changedFromRelease( themeDir, stylesheet, stylesheetVersion );
		if ( template !== stylesheet ) {
			const parentDir = path.join( themes, template );
			outcome.parentThemeChanges = await changedFromRelease( parentDir, template, templateVersion );
			// The parent's theme.json, which the child's is merged over.
			outcome.parentThemeJson = readThemeText( parentDir )[ 'theme.json' ];
			outcome.parentThemeFileList = Object.keys( hashFiles( parentDir ) ).sort();
		}
		const screenshot = path.join( artifactDir, `${ path.basename( sitePath ) }-home.jpg` );
		const home = {
			...( await renderHome( url ) ),
			imageFrames: await homeImageFrames( url ),
		};
		outcome.homeScreenshot = ( await saveHomeScreenshot( url, screenshot ) )
			? screenshot
			: undefined;
		if ( 'html' in home && home.html ) {
			const file = path.join( artifactDir, `${ path.basename( sitePath ) }-home.html` );
			writeFileSync( file, home.html );
			outcome.home = { ...home, html: undefined, htmlFile: file };
		} else {
			outcome.home = home;
		}

		const pages = ( state.content as Array< { type: string; link: string } > )
			.filter( ( item ) => item.type === 'page' )
			.map( ( item ) => item.link );
		outcome.formsSent = await sendPageForms( sitePath, pages ).catch( ( error ) => [
			{ error: error instanceof Error ? error.message : String( error ) },
		] );

		// Every published page, template and part, validated by the site's own editor.
		const invalid: Array< { id: number; type: string; slug: string; blocks: string[] } > = [];
		for ( const item of state.content as Array< {
			id: number;
			type: string;
			slug: string;
			content: string;
		} > ) {
			if ( ! item.content.includes( '<!-- wp:' ) ) continue;
			const report = await validateBlocks( item.content, url );
			if ( report.invalidBlocks > 0 ) {
				invalid.push( {
					id: item.id,
					type: item.type,
					slug: item.slug,
					blocks: report.results.filter( ( r ) => ! r.isValid ).map( ( r ) => r.blockName ),
				} );
			}
		}
		// A file as its WordPress.org release ships it is the theme author's, and
		// may hold blocks of a plugin the site does not run.
		const released = ( file: string ) =>
			Array.isArray( outcome.themeChanges ) && ! outcome.themeChanges.includes( file );
		for ( const [ file, text ] of Object.entries(
			outcome.themeFiles as Record< string, string >
		) ) {
			if ( ! /^(templates|parts)\/.+\.html$/.test( file ) || released( file ) ) continue;
			const report = await validateBlocks( text, url );
			if ( report.invalidBlocks > 0 ) {
				invalid.push( {
					id: 0,
					type: 'theme-file',
					slug: file,
					blocks: report.results.filter( ( r ) => ! r.isValid ).map( ( r ) => r.blockName ),
				} );
			}
		}
		outcome.invalidBlocks = invalid;
	} catch ( error ) {
		outcome.error = error instanceof Error ? error.message : String( error );
	} finally {
		await runStopSiteCommand( StopMode.STOP_SINGLE_SITE, sitePath, new Logger() ).catch(
			() => undefined
		);
	}
	return outcome;
}

export interface TurnOutcome {
	sites: SiteOutcome[];
	// Whether the turn changed the site the request was about (the active site).
	requestSiteChanged: boolean | null;
	// Sites that existed before the turn and were changed or removed by it.
	otherSitesChanged: string[];
	otherSitesRemoved: string[];
}

export async function captureTurnOutcome(
	before: SiteFingerprint[],
	requestSitePath: string | undefined,
	artifactDir: string
): Promise< TurnOutcome > {
	// Modification times are read before any capture starts a site.
	const after = new Map( ( await fingerprintSites() ).map( ( site ) => [ site.path, site ] ) );
	const beforePaths = new Set( before.map( ( site ) => site.path ) );
	const created = [ ...after.values() ].filter( ( site ) => ! beforePaths.has( site.path ) );
	const changed = ( site: SiteFingerprint ) => {
		const now = after.get( site.path );
		return (
			( now?.mtimeMs ?? 0 ) > site.mtimeMs ||
			JSON.stringify( now?.code ) !== JSON.stringify( site.code )
		);
	};
	const requestBefore = before.find( ( site ) => site.path === requestSitePath );
	const others = before.filter( ( site ) => site.path !== requestSitePath );

	const sites: SiteOutcome[] = [];
	const requestAfter = requestSitePath ? after.get( requestSitePath ) : undefined;
	if ( requestSitePath && requestAfter ) {
		sites.push(
			await captureSiteOutcome(
				requestSitePath,
				false,
				artifactDir,
				requestBefore ? { before: requestBefore.code, after: requestAfter.code } : undefined
			)
		);
	}
	for ( const site of created ) {
		sites.push( await captureSiteOutcome( site.path, true, artifactDir ) );
	}
	return {
		sites,
		requestSiteChanged: requestBefore ? changed( requestBefore ) : null,
		otherSitesChanged: others
			.filter( ( site ) => after.has( site.path ) && changed( site ) )
			.map( ( site ) => site.name ),
		otherSitesRemoved: others
			.filter( ( site ) => ! after.has( site.path ) )
			.map( ( site ) => site.name ),
	};
}
