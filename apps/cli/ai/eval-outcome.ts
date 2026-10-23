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
import { validateBlocks } from 'cli/ai/block-validator';
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
// moves whenever the site is changed.
function newestMtime( dir: string, depth = 6 ): number {
	let newest = 0;
	const walk = ( current: string, level: number ) => {
		let entries;
		try {
			entries = readdirSync( current, { withFileTypes: true } );
		} catch {
			return;
		}
		for ( const entry of entries ) {
			if ( entry.name === 'node_modules' || entry.name === 'cache' ) continue;
			const full = path.join( current, entry.name );
			try {
				newest = Math.max( newest, statSync( full ).mtimeMs );
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
	$content[] = array( 'id' => $post->ID, 'type' => $post->post_type, 'slug' => $post->post_name, 'title' => $post->post_title, 'isFront' => $post->ID === $front, 'blocks' => $blocks, 'content' => $post->post_content );
}
$styles = array();
foreach ( WP_Block_Styles_Registry::get_instance()->get_all_registered() as $block => $variations ) {
	$styles[ $block ] = array_keys( $variations );
}
$merged = WP_Theme_JSON_Resolver::get_merged_data()->get_raw_data();
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
	'products' => post_type_exists( 'product' ) ? (int) wp_count_posts( 'product' )->publish : 0,
	'blockStyles' => $styles,
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
			hashes[ `${ dir }/${ file }` ] = hash;
		}
	}
	return hashes;
}

export interface CodeChange {
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
		return {
			status: response.status,
			html,
			phpErrors: [
				...html.matchAll( /<b>(Fatal error|Parse error|Warning|Notice|Deprecated)<\/b>:[^<]*/g ),
			].map( ( m ) => m[ 0 ].replace( /<\/?b>/g, '' ) ),
			images,
			navHrefs: [ ...nav.matchAll( /<a\b[^>]*\bhref="([^"]*)"/g ) ].map( ( m ) => m[ 1 ] ),
			ids: [ ...html.matchAll( /\bid="([^"]+)"/g ) ].map( ( m ) => m[ 1 ] ),
		};
	} catch ( error ) {
		return { status: 0, error: error instanceof Error ? error.message : String( error ) };
	}
}

export interface SiteOutcome {
	name: string;
	path: string;
	created: boolean;
	url?: string;
	error?: string;
	[ key: string ]: unknown;
}

export async function captureSiteOutcome(
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
			outcome.parentThemeChanges = await changedFromRelease(
				path.join( themes, template ),
				template,
				templateVersion
			);
		}
		const designPath = path.join( sitePath, 'DESIGN.md' );
		outcome.designMd = existsSync( designPath ) ? readFileSync( designPath, 'utf8' ) : null;

		const home = await renderHome( url );
		if ( 'html' in home && home.html ) {
			const file = path.join( artifactDir, `${ path.basename( sitePath ) }-home.html` );
			writeFileSync( file, home.html );
			outcome.home = { ...home, html: undefined, htmlFile: file };
		} else {
			outcome.home = home;
		}

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
		for ( const [ file, text ] of Object.entries(
			outcome.themeFiles as Record< string, string >
		) ) {
			if ( ! /^(templates|parts)\/.+\.html$/.test( file ) ) continue;
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
	const changed = ( site: SiteFingerprint ) =>
		( after.get( site.path )?.mtimeMs ?? 0 ) > site.mtimeMs;
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
