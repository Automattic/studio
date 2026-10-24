/**
 * Structural guards for the agent's file tools on a local site.
 *
 * Instead of teaching the model WordPress rules in prose, a write to a site's
 * file is checked at the moment of the change: before it, whether an update
 * would replace the file; after it, the theme's pattern cache is cleared and
 * the agent hears what WordPress will render differently from the file. Studio
 * Code's Write and Edit and the plugin's hooks on other agents' file tools
 * (runtimes/hooks) run the same checks.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { unlink, writeFile } from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';
import { selfHostThemeJsonFonts } from '@studio/common/lib/theme-fonts';
import { trappedFullWidthNotes } from 'cli/ai/block-alignment';
import { renderDesignBoard } from 'cli/ai/design-board';
import { savedCopyWriteNote } from 'cli/ai/saved-copies';
import { resolveScreenshotDirectory } from 'cli/ai/screenshot-storage';
import { readWordPressSite } from 'cli/ai/site-database';
import { isUpdatableTheme } from 'cli/ai/themes';
import { captureScreenshotBuffer } from 'cli/ai/tools/screenshot-helpers';
import { resolveSite } from 'cli/ai/tools/utils';
import { findSiteByFolder } from 'cli/lib/cli-config/sites';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import type { BlockValidationGate } from 'cli/ai/block-validation-gate';

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
	filePath: string,
	isStudioSite: ( folder: string ) => Promise< boolean > = isStudioSiteFolder
): Promise< string | undefined > {
	const siteFile = resolveSiteFile( filePath );
	if ( ! siteFile ) {
		return undefined;
	}
	const { siteRoot, relativePath, theme } = siteFile;
	let reason: string | undefined;
	if (
		relativePath.startsWith( 'wp-includes/' ) ||
		relativePath.startsWith( 'wp-admin/' ) ||
		CORE_ROOT_FILE.test( relativePath )
	) {
		reason = `${ relativePath } is this Studio site's copy of WordPress core, which a WordPress update replaces. Read it as reference. Make the change in wp-content/ (a theme, child theme, or plugin).`;
	} else if ( theme && ( await isUpdatableTheme( siteRoot, theme.slug ) ) ) {
		reason = `${ theme.slug } is a theme WordPress updates, and an update overwrites changes to its files. Make the change in a child theme of it, whose style.css names \`Template: ${ theme.slug }\`.`;
	}
	if ( ! reason || ! ( await isStudioSite( siteRoot ) ) ) {
		return undefined;
	}
	return `Not run: ${ reason }`;
}

// Palette slugs whose `.has-<slug>-color` class (class-wp-theme-json.php) is
// the class the block editor saves on every block with its own text or link
// color (wp-includes/js/dist/block-editor.js).
const MARKER_SLUGS = [ 'text', 'link' ];

/** What a theme.json just written makes WordPress render differently from what it says. */
function themeJsonNotes( themeJson: unknown, themePath: string ): string[] {
	const palette = ( themeJson as { settings?: { color?: { palette?: { slug?: unknown }[] } } } )
		?.settings?.color?.palette;
	return ( Array.isArray( palette ) ? palette : [] )
		.filter( ( { slug } ) => MARKER_SLUGS.includes( slug as string ) )
		.map(
			( { slug } ) =>
				`${ themePath }/theme.json names a palette color \`${ slug }\`, so WordPress generates \`.has-${ slug }-color\` for it (wp-includes/class-wp-theme-json.php): the class the block editor also saves on every block with its own ${ slug } color, which then loses that color to \`${ slug }\`. Rename the slug.`
		);
}

// Block markup files: a theme's templates, parts and patterns, and page
// content scratch files.
function isBlockMarkup( { relativePath, theme }: SiteFile ): boolean {
	return theme
		? /^(templates|parts|patterns)\/[^/]+\.(html|php)$/.test( theme.file )
		: /^tmp\/[^/]+\.html$/.test( relativePath );
}

/** What WordPress will render differently from the file just written, if anything. */
async function getSiteFileWriteNotes( siteFile: SiteFile ): Promise< string[] > {
	const { siteRoot, relativePath, theme } = siteFile;
	const notes: string[] = [];
	if ( isBlockMarkup( siteFile ) ) {
		notes.push(
			...trappedFullWidthNotes( readFileSync( path.join( siteRoot, relativePath ), 'utf8' ) )
		);
	}
	if ( ! theme ) {
		return notes;
	}
	if ( theme.file === 'theme.json' ) {
		const themeJson = JSON.parse( readFileSync( path.join( theme.dir, theme.file ), 'utf8' ) );
		notes.push( ...themeJsonNotes( themeJson, `wp-content/themes/${ theme.slug }` ) );
	}
	if ( theme.file.endsWith( '.css' ) ) {
		const css = readFileSync( path.join( theme.dir, theme.file ), 'utf8' );
		notes.push( ...lintThemeCss( css, await getBlockClassNames( siteRoot, theme.dir ) ) );
	}
	const savedCopy = await readWordPressSite( siteRoot, ( site ) =>
		savedCopyWriteNote( site, path.join( siteRoot, relativePath ) )
	);
	if ( savedCopy ) {
		notes.push( savedCopy );
	}
	return notes;
}

/**
 * Self-hosts the fonts a theme.json just written declares without font files,
 * and says what it downloaded.
 */
async function selfHostFonts( siteFile: SiteFile ): Promise< string[] > {
	const { theme } = siteFile;
	if ( theme?.file !== 'theme.json' ) {
		return [];
	}
	const { hosted, failed } = await selfHostThemeJsonFonts( theme.dir );
	const themePath = `wp-content/themes/${ theme.slug }`;
	return [
		...( hosted.length
			? [
					`Studio downloaded the font files of ${ hosted.join(
						', '
					) } from Google Fonts into ${ themePath }/assets/fonts and declared them as their fontFace in theme.json.`,
			  ]
			: [] ),
		...failed.map(
			( { family, error } ) =>
				`${ family } has no font files in ${ themePath }/theme.json, and Google Fonts did not provide them (${ error }). Put its files in ${ themePath }/assets/fonts and declare them as its fontFace, or choose a Google Fonts family.`
		),
	];
}

const THUMBNAIL = { width: 1200, height: 900 } as const;

/**
 * Gives a theme without a thumbnail one: its theme.json's design board, the
 * 1200×900 screenshot.png Appearance → Themes shows.
 */
async function writeThemeThumbnail( siteFile: SiteFile ): Promise< string[] > {
	const { theme } = siteFile;
	if (
		theme?.file !== 'theme.json' ||
		readdirSync( theme.dir ).some( ( file ) => /^screenshot\.(png|jpe?g|gif|webp)$/.test( file ) )
	) {
		return [];
	}
	const board = renderDesignBoard( readFileSync( path.join( theme.dir, theme.file ), 'utf8' ) );
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
 * After a write to a site's file: registers a changed pattern, self-hosts the
 * theme's fonts, gives it a thumbnail, and returns what WordPress will render
 * differently from the file.
 */
export async function afterSiteFileWrite( siteFile: SiteFile ): Promise< string[] > {
	await clearThemePatternCache( siteFile ).catch( () => undefined );
	const fonts = await selfHostFonts( siteFile ).catch( () => [] );
	const thumbnail = await writeThemeThumbnail( siteFile ).catch( () => [] );
	return [
		...fonts,
		...thumbnail,
		...( await getSiteFileWriteNotes( siteFile ).catch( () => [] ) ),
	];
}

/**
 * WordPress caches the list of a theme's pattern files (outside theme
 * development mode), so a pattern file added or changed would not register.
 * Clears that theme's cache after a write to its patterns/ directory.
 */
export async function clearThemePatternCache( siteFile: SiteFile ): Promise< void > {
	const { siteRoot, theme } = siteFile;
	if ( ! theme || ! /^patterns\/[^/]+\.php$/.test( theme.file ) ) {
		return;
	}
	const site = await resolveSite( siteRoot );
	try {
		await connectToDaemon();
		await using command = await runWpCliCommand( site, [
			'eval',
			`wp_get_theme( ${ JSON.stringify( theme.slug ) } )->delete_pattern_cache();`,
		] );
		await command.response.exitCode;
	} finally {
		await disconnectFromDaemon();
	}
}

interface ToolResult {
	content?: Array< { type: string; text?: string } >;
}

interface FileWritingTool {
	execute( toolCallId: string, params: { path?: unknown }, ...rest: unknown[] ): Promise< unknown >;
}

/** Wraps Write or Edit with the site file guards. */
export function withSiteFileGuards< TTool extends FileWritingTool >(
	tool: TTool,
	cwd: string,
	gate?: BlockValidationGate
): TTool {
	return {
		...tool,
		async execute( toolCallId: string, params: { path?: unknown }, ...rest: unknown[] ) {
			const siteFile =
				typeof params.path === 'string'
					? resolveSiteFile( path.resolve( cwd, params.path ) )
					: undefined;
			const result = ( await tool.execute( toolCallId, params, ...rest ) ) as ToolResult;
			if ( siteFile && gate ) {
				gate.track( path.join( siteFile.siteRoot, siteFile.relativePath ), siteFile.siteRoot );
			}
			const notes = siteFile ? await afterSiteFileWrite( siteFile ) : [];
			if ( ! notes.length || ! result || typeof result !== 'object' ) {
				return result;
			}
			return {
				...result,
				content: [
					...( result.content ?? [] ),
					{ type: 'text', text: notes.map( ( note ) => `Note: ${ note }` ).join( '\n' ) },
				],
			};
		},
	};
}
