/**
 * What a write to a local site's file means to WordPress: before it, whether
 * an update would replace the file; after it, what Studio does for the file
 * and what WordPress will render differently from it. site-notes.ts lists
 * these with the trigger each runs on.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { readFile, unlink, writeFile } from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';
import { selfHostThemeJsonFonts } from '@studio/common/lib/theme-fonts';
import { freeTrappedBlocks, trappedFullWidthNotes } from 'cli/ai/block-alignment';
import { opensWithBlock } from 'cli/ai/block-validation-gate';
import { buttonsWithoutLinkNotes } from 'cli/ai/button-links';
import { renderDesignBoard } from 'cli/ai/design-board';
import {
	FRONT_PAGE_TEMPLATE,
	frontPageTemplateProblem,
	rendersPageContent,
} from 'cli/ai/front-page-template';
import { savedCopyWriteNote } from 'cli/ai/saved-copies';
import { resolveScreenshotDirectory } from 'cli/ai/screenshot-storage';
import { readWordPressSite } from 'cli/ai/site-database';
import { updatableThemeChangeHome } from 'cli/ai/theme-file-changes';
import { isUpdatableTheme, wordPressOrgNamesake } from 'cli/ai/themes';
import { captureScreenshotBuffer } from 'cli/ai/tools/screenshot-helpers';
import { resolveSite } from 'cli/ai/tools/utils';
import { findSiteByFolder } from 'cli/lib/cli-config/sites';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';

export interface SiteFile {
	siteRoot: string;
	relativePath: string;
	theme?: { slug: string; dir: string; file: string };
}

/** Locates the WordPress site a path belongs to, and its theme if it is in one. */
export function resolveSiteFile( filePath: string ): SiteFile | undefined {
	let dir = path.dirname( filePath );
	while ( dir !== path.dirname( dir ) ) {
		if (
			existsSync( path.join( dir, 'wp-includes' ) ) &&
			existsSync( path.join( dir, 'wp-content' ) )
		) {
			const relativePath = path.relative( dir, filePath ).split( path.sep ).join( '/' );
			const themeMatch = relativePath.match( /^wp-content\/themes\/([^/]+)\/(.+)$/ );
			return {
				siteRoot: dir,
				relativePath,
				theme: themeMatch
					? {
							slug: themeMatch[ 1 ],
							dir: path.join( dir, 'wp-content', 'themes', themeMatch[ 1 ] ),
							file: themeMatch[ 2 ],
					  }
					: undefined,
			};
		}
		dir = path.dirname( dir );
	}
	return undefined;
}

const INLINE_DISPLAY = /(^|;|\s)display\s*:\s*inline(-block|-flex|-grid)?\s*(;|$|!)/i;
const BOX_DECLARATION = /(^|;|\s)(padding[a-z-]*|background[a-z-]*|border[a-z-]*)\s*:/i;
const VIEWPORT_BREAKOUT = /calc\(\s*50%\s*-\s*50d?vw\s*\)|(^|;|\s)width\s*:\s*100d?vw/i;

function listFiles( dir: string, extensions: string[], depth = 3 ): string[] {
	if ( depth < 0 || ! existsSync( dir ) ) {
		return [];
	}
	return readdirSync( dir ).flatMap( ( entry ) => {
		const full = path.join( dir, entry );
		if ( statSync( full ).isDirectory() ) {
			return listFiles( full, extensions, depth - 1 );
		}
		return extensions.includes( path.extname( entry ) ) ? [ full ] : [];
	} );
}

async function getBlockClassNames( siteRoot: string, themeDir: string ): Promise< Set< string > > {
	const sources = [
		...listFiles( themeDir, [ '.html', '.php' ] ),
		...listFiles( path.join( siteRoot, 'tmp' ), [ '.html' ], 0 ),
	].map( ( file ) => readFileSync( file, 'utf8' ) );
	const saved = await readWordPressSite( siteRoot, ( site ) =>
		site.query< { content: string } >(
			`SELECT post_content AS content FROM ${ site.prefix }posts WHERE post_content LIKE '%"className":%' AND post_status = 'publish'`
		)
	);
	for ( const row of saved ) {
		sources.push( row.content );
	}
	const classNames = new Set< string >();
	for ( const source of sources ) {
		for ( const match of source.matchAll( /"className"\s*:\s*"([^"]+)"/g ) ) {
			match[ 1 ].split( /\s+/ ).forEach( ( name ) => classNames.add( name ) );
		}
	}
	return classNames;
}

/** CSS in a theme stylesheet that fights WordPress's block layout. */
export function lintThemeCss( css: string, blockClassNames: Set< string > ): string[] {
	const notes: string[] = [];
	const withoutComments = css.replace( /\/\*[\s\S]*?\*\//g, '' );
	for ( const rule of withoutComments.matchAll( /([^{}]+)\{([^{}]*)\}/g ) ) {
		const declarations = rule[ 2 ];
		for ( const selector of rule[ 1 ].split( ',' ).map( ( part ) => part.trim() ) ) {
			const single = selector.match( /^\.([A-Za-z0-9_-]+)$/ );
			if ( single && blockClassNames.has( single[ 1 ] ) && INLINE_DISPLAY.test( declarations ) ) {
				notes.push(
					`\`${ selector }\` is a block className and gets an inline-level display. Blocks in a constrained layout are placed with auto inline margins (wp-includes/block-supports/layout.php), which inline-level boxes ignore, so this block leaves the content column. To shrink-wrap it, wrap it in a group with a flex layout and drop the display rule.`
				);
			}
			if ( VIEWPORT_BREAKOUT.test( declarations ) ) {
				notes.push(
					`\`${ selector }\` stretches to the viewport width with CSS. WordPress spans a block across the page with align full (wp-includes/block-supports/layout.php): give the block align full instead, and when it still stops short, a block around it is not full width.`
				);
			}
			if (
				/(^|\s)\.wp-block-button(?![\w-])(?!.*\.wp-(block-button__link|element-button))/.test(
					selector
				) &&
				BOX_DECLARATION.test( declarations )
			) {
				notes.push(
					`\`${ selector }\` styles the button block's wrapper. WordPress paints buttons on the inner \`.wp-element-button\` link (see wp-includes/blocks/button/), so box styles here stack on top of it; target \`.wp-element-button\` instead.`
				);
			}
		}
	}
	return notes;
}

const CORE_ROOT_FILE = /^(index|xmlrpc|wp-(?!config\b)[a-z-]+)\.php$/;

async function isStudioSiteFolder( folder: string ): Promise< boolean > {
	return Boolean( await findSiteByFolder( folder ) );
}

/**
 * Why a write to this file of a Studio site would be lost, and where the
 * change belongs: WordPress core is replaced when WordPress updates, and a
 * theme's files when WordPress updates the theme. Undefined when the write
 * stays, and for WordPress trees Studio doesn't manage.
 */
export async function getSiteFileWriteRefusal(
	{ siteRoot, relativePath, theme }: SiteFile,
	isStudioSite: ( folder: string ) => Promise< boolean > = isStudioSiteFolder
): Promise< string | undefined > {
	let reason: string | undefined;
	if (
		relativePath.startsWith( 'wp-includes/' ) ||
		relativePath.startsWith( 'wp-admin/' ) ||
		CORE_ROOT_FILE.test( relativePath )
	) {
		reason = `${ relativePath } is this Studio site's copy of WordPress core, which a WordPress update replaces. Read it as reference. Make the change in wp-content/ (a theme, child theme, or plugin).`;
	} else if (
		theme &&
		( await isUpdatableTheme( siteRoot, theme.slug ) ) &&
		// A theme of its own in a WordPress.org theme's folder is the change's place.
		! ( await wordPressOrgNamesake( siteRoot, theme.slug ) )
	) {
		reason = `${
			theme.slug
		} is a theme WordPress updates, and an update overwrites changes to its files. Make the change in ${ updatableThemeChangeHome(
			theme.dir,
			theme.slug,
			theme.file
		) }.`;
	}
	return reason && ( await isStudioSite( siteRoot ) ) ? reason : undefined;
}

// Palette slugs whose `.has-<slug>-color` class (class-wp-theme-json.php) is
// the class the block editor saves on every block with its own text or link
// color (wp-includes/js/dist/block-editor.js).
const MARKER_SLUGS = [ 'text', 'link' ];

function paletteNotes( themeJson: unknown, themePath: string ): string[] {
	const palette = ( themeJson as { settings?: { color?: { palette?: { slug?: unknown }[] } } } )
		?.settings?.color?.palette;
	return ( Array.isArray( palette ) ? palette : [] )
		.filter( ( { slug } ) => MARKER_SLUGS.includes( slug as string ) )
		.map(
			( { slug } ) =>
				`${ themePath }/theme.json names a palette color \`${ slug }\`, so WordPress generates \`.has-${ slug }-color\` for it (wp-includes/class-wp-theme-json.php): the class the block editor also saves on every block with its own ${ slug } color, which then loses that color to \`${ slug }\`. Rename the slug.`
		);
}

// Block markup files: a theme's templates, parts and patterns, and any file
// that opens with a block, as a page draft does wherever it is written.
export function isBlockMarkup( siteFile: SiteFile ): boolean {
	return (
		/^(templates|parts|patterns)\/[^/]+\.(html|php)$/.test( siteFile.theme?.file ?? '' ) ||
		opensWithBlock( readSiteFile( siteFile ) )
	);
}

const readSiteFile = ( { siteRoot, relativePath }: SiteFile ) =>
	readFileSync( path.join( siteRoot, relativePath ), 'utf8' );

// Whether the site's core block type supports align full, by its block.json.
function supportsFull( siteRoot: string, name: string ): boolean {
	if ( ! name.startsWith( 'core/' ) ) {
		return false;
	}
	try {
		const { supports } = JSON.parse(
			readFileSync(
				path.join( siteRoot, 'wp-includes/blocks', name.slice( 5 ), 'block.json' ),
				'utf8'
			)
		);
		return (
			supports?.align === true ||
			( Array.isArray( supports?.align ) && supports.align.includes( 'full' ) )
		);
	} catch {
		return false;
	}
}

/**
 * Block markup just written, with each block that keeps full-width blocks
 * from the page edges made align full where that changes nothing else.
 */
export async function freeFullWidthBlocks( siteFile: SiteFile ): Promise< string[] > {
	if ( ! isBlockMarkup( siteFile ) ) {
		return [];
	}
	const { markup, freed } = freeTrappedBlocks( readSiteFile( siteFile ), ( name ) =>
		supportsFull( siteFile.siteRoot, name )
	);
	if ( ! freed.length ) {
		return [];
	}
	await writeFile( path.join( siteFile.siteRoot, siteFile.relativePath ), markup );
	return [
		`Studio made ${ freed.join( ', ' ) } align full in ${
			siteFile.relativePath
		}, so the full-width blocks in it reach the page edges: the constrained layout around it held it to the content width, and its own constrained layout holds its other blocks to that width as before (wp-includes/block-supports/layout.php).`,
	];
}

/** Blocks in block markup just written that cannot reach the page edges, and buttons that open nothing. */
export function blockMarkupNotes( siteFile: SiteFile ): string[] {
	if ( ! isBlockMarkup( siteFile ) ) {
		return [];
	}
	const markup = readSiteFile( siteFile );
	return [ ...trappedFullWidthNotes( markup ), ...buttonsWithoutLinkNotes( markup ) ];
}

/** What a theme.json just written makes WordPress render differently from what it says. */
export function themeJsonNotes( siteFile: SiteFile ): string[] {
	const { theme } = siteFile;
	return theme?.file === 'theme.json'
		? paletteNotes( JSON.parse( readSiteFile( siteFile ) ), `wp-content/themes/${ theme.slug }` )
		: [];
}

/** CSS in a theme stylesheet just written that fights WordPress's block layout. */
export async function themeCssNotes( siteFile: SiteFile ): Promise< string[] > {
	const { siteRoot, theme } = siteFile;
	return theme?.file.endsWith( '.css' )
		? lintThemeCss( readSiteFile( siteFile ), await getBlockClassNames( siteRoot, theme.dir ) )
		: [];
}

const IMAGE_SOURCE =
	/<img\b[^>]*?\bsrc="(https?:\/\/[^"]+)"|background(?:-image)?\s*:[^;}]*?url\(\s*['"]?(https?:\/\/[^'")\s]+)/gi;

/** Images that block markup or a theme stylesheet just written shows from hosts other than the site. */
export async function externalImageNotes( siteFile: SiteFile ): Promise< string[] > {
	if ( ! isBlockMarkup( siteFile ) && ! siteFile.theme?.file.endsWith( '.css' ) ) {
		return [];
	}
	const siteUrl = await readWordPressSite( siteFile.siteRoot, ( site ) =>
		site.option( 'siteurl' )
	);
	if ( typeof siteUrl !== 'string' ) {
		return [];
	}
	const siteHost = new URL( siteUrl ).host;
	const hosts = new Set(
		[ ...readSiteFile( siteFile ).matchAll( IMAGE_SOURCE ) ]
			.map( ( match ) => match[ 1 ] ?? match[ 2 ] )
			.map( ( url ) => ( URL.canParse( url ) ? new URL( url ).host : undefined ) )
			.filter( ( host ) => host && host !== siteHost )
	);
	return hosts.size
		? [
				`${ siteFile.relativePath } shows images from ${ [ ...hosts ].join(
					', '
				) }, which this site does not hold: they break when that host moves or blocks them, and WordPress gives responsive sizes only to images in its media library, by their wp-image-<ID> class (wp_filter_content_tags in wp-includes/media.php). Generate them, or import them with \`wp media import\`, and use their URLs and attachment IDs.`,
		  ]
		: [];
}

/** That WordPress renders a saved Site Editor copy instead of the file just written. */
export async function savedCopyNotes( { siteRoot, relativePath }: SiteFile ): Promise< string[] > {
	const note = await readWordPressSite( siteRoot, ( site ) =>
		savedCopyWriteNote( site, path.join( siteRoot, relativePath ) )
	);
	return note ? [ note ] : [];
}

/**
 * Self-hosts the fonts a theme.json just written declares without font files,
 * and says what it downloaded.
 */
export async function selfHostFonts( siteFile: SiteFile ): Promise< string[] > {
	const { theme } = siteFile;
	if ( theme?.file !== 'theme.json' ) {
		return [];
	}
	const { hosted, missing, failed } = await selfHostThemeJsonFonts( theme.dir );
	const themePath = `wp-content/themes/${ theme.slug }`;
	return [
		...( hosted.length
			? [
					`Studio downloaded the font files of ${ hosted.join(
						', '
					) } from Google Fonts into ${ themePath }/assets/fonts and declared them as their fontFace in theme.json${
						missing.length
							? `, in place of the files the fontFace of ${ missing.join(
									', '
							  ) } named, which neither the theme nor its parent has: WordPress looks for a "file:./" source there (get_theme_file_uri() in wp-includes/link-template.php), so the browser was given font files that do not exist`
							: ''
					}.`,
			  ]
			: [] ),
		...failed.map(
			( { family, font, error } ) =>
				`${ family } in ${ themePath }/theme.json asks first for ${ font }, which Google Fonts does not serve (${ error }), so the font each visitor sees is whichever their device has. Twenty Twenty-Five ships each family's files in the theme and declares them as its fontFace: put ${ font }'s files in ${ themePath }/assets/fonts and declare them, or choose a Google Fonts family, which Studio downloads.`
		),
	];
}

const THUMBNAIL = { width: 1200, height: 900 } as const;

// The parent a child theme's style.css names (`Template:`), or undefined.
async function parentThemeDir( themeDir: string ): Promise< string | undefined > {
	const parent = (
		await readFile( path.join( themeDir, 'style.css' ), 'utf8' ).catch( () => '' )
	).match( /^[\s*]*Template:\s*(\S+)/im )?.[ 1 ];
	return parent ? path.join( path.dirname( themeDir ), parent ) : undefined;
}

// A theme's theme.json as WordPress resolves it: a child's merged over its
// parent's (WP_Theme_JSON_Resolver::get_theme_data()), a list it declares,
// such as a preset list, replacing the parent's (WP_Theme_JSON::merge()).
async function resolvedThemeJson( themeDir: string ): Promise< object | undefined > {
	const read = async ( dir: string | undefined ) =>
		dir
			? readFile( path.join( dir, 'theme.json' ), 'utf8' )
					.then( ( text ): unknown => JSON.parse( text ) )
					.catch( () => undefined )
			: undefined;
	const [ own, parent ] = await Promise.all( [
		read( themeDir ),
		read( await parentThemeDir( themeDir ) ),
	] );
	const merged = mergeThemeJson( parent, own );
	return isObject( merged ) ? merged : undefined;
}

const isObject = ( value: unknown ): value is Record< string, unknown > =>
	Boolean( value ) && typeof value === 'object' && ! Array.isArray( value );

function mergeThemeJson( base: unknown, incoming: unknown ): unknown {
	if ( ! isObject( base ) || ! isObject( incoming ) ) {
		return incoming ?? base;
	}
	const merged: Record< string, unknown > = { ...base };
	for ( const [ key, value ] of Object.entries( incoming ) ) {
		merged[ key ] = mergeThemeJson( base[ key ], value );
	}
	return merged;
}

/**
 * Gives a theme without a thumbnail one, once its theme.json or style.css is
 * written: the design board of the theme.json WordPress resolves for it, the
 * 1200×900 screenshot.png Appearance → Themes shows (WP_Theme::get_screenshot()
 * reads the theme's own directory, a child's too).
 */
export async function writeThemeThumbnail( siteFile: SiteFile ): Promise< string[] > {
	const { theme } = siteFile;
	if (
		( theme?.file !== 'theme.json' && theme?.file !== 'style.css' ) ||
		readdirSync( theme.dir ).some( ( file ) => /^screenshot\.(png|jpe?g|gif|webp)$/.test( file ) )
	) {
		return [];
	}
	const themeJson = await resolvedThemeJson( theme.dir );
	if ( ! themeJson ) {
		return [];
	}
	const board = renderDesignBoard( JSON.stringify( themeJson ) );
	const page = path.join( await resolveScreenshotDirectory(), `thumbnail-${ theme.slug }.html` );
	await writeFile( page, `\ufeff${ board }` );
	try {
		const { buffer } = await captureScreenshotBuffer( pathToFileURL( page ).href, THUMBNAIL, {
			fullPage: false,
			format: 'png',
		} );
		await writeFile( path.join( theme.dir, 'screenshot.png' ), buffer );
	} finally {
		await unlink( page );
	}
	return [
		`Studio saved the theme's design board as wp-content/themes/${ theme.slug }/screenshot.png, its thumbnail in Appearance → Themes.`,
	];
}

/**
 * WordPress caches the list of a theme's pattern files (outside theme
 * development mode), so a pattern file added or changed would not register.
 * Clears that theme's cache after a write to its patterns/ directory.
 */
export async function clearThemePatternCache( siteFile: SiteFile ): Promise< string[] > {
	const { siteRoot, theme } = siteFile;
	if ( ! theme || ! /^patterns\/[^/]+\.php$/.test( theme.file ) ) {
		return [];
	}
	const site = await resolveSite( siteRoot );
	await using command = await runWpCliCommand( site, [
		'eval',
		`wp_get_theme( ${ JSON.stringify( theme.slug ) } )->delete_pattern_cache();`,
	] );
	await command.response.exitCode;
	return [];
}

/**
 * A theme's front-page template written without a page's content
 * (front-page-template.ts), noted for the file whether or not its theme is
 * active yet.
 */
export async function frontPageTemplateNotes( {
	siteRoot,
	relativePath,
	theme,
}: SiteFile ): Promise< string[] > {
	if ( theme?.file !== FRONT_PAGE_TEMPLATE ) {
		return [];
	}
	const template = await readFile( path.join( siteRoot, relativePath ), 'utf8' );
	const parent = await parentThemeDir( theme.dir );
	const themeDirs = [ theme.dir, ...( parent ? [ parent ] : [] ) ];
	return ( await rendersPageContent( template, themeDirs ) ) === false
		? [ frontPageTemplateProblem( relativePath ) ]
		: [];
}
