/**
 * What a write to a local site's file means to WordPress: before it, whether
 * an update would replace the file; after it, what Studio does for the file
 * and what WordPress will render differently from it. site-notes.ts lists
 * these with the trigger each runs on.
 */
import { readFileSync } from 'fs';
import { access, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { selfHostThemeJsonFonts } from '@studio/common/lib/theme-fonts';
import { freeTrappedBlocks, trappedFullWidthNotes } from '@studio/agent/node/block-alignment';
import { buttonsWithoutLinkNotes } from '@studio/agent/node/button-links';
import {
	FRONT_PAGE_TEMPLATE,
	frontPageTemplateProblem,
	rendersPageContent,
} from '@studio/agent/node/front-page-template';
import { savedCopyWriteNote } from '@studio/agent/node/saved-copies';
import { readWordPressSite } from '@studio/agent/node/site-database';
import { isBlockMarkup, readSiteFile, type SiteFile } from '@studio/agent/node/site-file';
import {
	otherHome,
	ownThemeHome,
	updatableThemeChangeHome,
} from '@studio/agent/node/theme-file-changes';
import { isUpdatableTheme, parentThemeDir, wordPressOrgNamesake } from '@studio/agent/node/themes';
import type { StudioAgentHost } from '@studio/agent/node/host';

const CORE_ROOT_FILE = /^(index|xmlrpc|wp-(?!config\b)[a-z-]+)\.php$/;

/**
 * Why a write to this file of a Studio site would be lost, and where the
 * change belongs: WordPress core is replaced when WordPress updates, and a
 * theme's files when WordPress updates the theme. Undefined when the write
 * stays, and for WordPress trees Studio doesn't manage.
 */
export async function getSiteFileWriteRefusal(
	host: StudioAgentHost,
	{ siteRoot, relativePath, theme }: SiteFile
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
		} is a theme WordPress updates, and an update overwrites changes to its files. Make the change in ${ ownThemeHome(
			theme.slug
		) }.${ otherHome(
			theme.slug,
			updatableThemeChangeHome( theme.dir, theme.slug, theme.file ),
			'it'
		) }`;
	}
	return reason && ( await host.sites.findByFolder( siteRoot ) ) ? reason : undefined;
}

// The folders WordPress reads a block theme's templates and parts from
// (get_block_theme_folders() in wp-includes/block-template-utils.php).
const BLOCK_TEMPLATE_FILE = /^(templates|parts)\/.+\.html$/;
const PHP_TAG = /<\?(php|=)/i;

/**
 * Why PHP written into a block theme's template or part would not run:
 * WordPress reads those files as text, and runs the PHP in the theme's
 * patterns, where Twenty Twenty-Five builds its image URLs.
 */
export function phpInBlockTemplateRefusal( { theme }: SiteFile, text: string ): string | undefined {
	if ( ! theme || ! BLOCK_TEMPLATE_FILE.test( theme.file ) || ! PHP_TAG.test( text ) ) {
		return undefined;
	}
	const pattern = `${ theme.slug }/<name>`;
	return `${ path.join( theme.dir, theme.file ) } is a block theme's ${
		theme.file.startsWith( 'parts/' ) ? 'template part' : 'template'
	}, which WordPress reads as text (file_get_contents() in _build_block_template_result_from_file(), wp-includes/block-template-utils.php), so PHP in it reaches the page as written. WordPress runs the PHP in a theme's patterns: write it in ${ path.join(
		theme.dir,
		'patterns',
		'<name>.php'
	) } with a "Slug: ${ pattern }" header, and place the pattern with <!-- wp:pattern {"slug":"${ pattern }"} /-->, as Twenty Twenty-Five's templates do.`;
}

const PART_IN_TEMPLATES = /^templates\/parts\/(.+\.html)$/;

/**
 * Why a template part written to templates/parts/ would not render: WordPress
 * names a template by its path under templates/, so templates/parts/header.html
 * is a template named "parts/header", and it reads template parts from parts/.
 */
export function partInTemplatesRefusal( { theme }: SiteFile ): string | undefined {
	const part = theme?.file.match( PART_IN_TEMPLATES )?.[ 1 ];
	if ( ! theme || ! part ) {
		return undefined;
	}
	return `WordPress reads a block theme's template parts from parts/ (get_block_theme_folders() in wp-includes/block-template-utils.php), and names a template by its path under templates/ (_get_block_templates_files()), so ${ path.join(
		theme.dir,
		theme.file
	) } is a template named "parts/${ part.slice(
		0,
		-5
	) }" that no template part block renders. Write it to ${ path.join(
		theme.dir,
		'parts',
		part
	) }.`;
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
	const { hosted, missing, downloaded, failed } = await selfHostThemeJsonFonts( theme.dir );
	const themePath = `wp-content/themes/${ theme.slug }`;
	return [
		...( downloaded.length
			? [
					`Studio downloaded the font files the fontFace of ${ downloaded.join(
						', '
					) } named by URL into ${ themePath }/assets/fonts and named them as "file:./" sources in theme.json, so the site serves its own fonts, as the Font Library keeps each font it installs as a file on the site (wp_font_dir() in wp-includes/fonts.php).`,
			  ]
			: [] ),
		...( hosted.length
			? [
					`Studio downloaded the font files of ${ hosted.join(
						', '
					) } from Google Fonts into ${ themePath }/assets/fonts and declared them as their fontFace in theme.json${
						missing.length
							? `, in place of the files the fontFace of ${ missing.join(
									', '
							  ) } named, which the browser cannot load: WordPress serves a "file:./" source from the theme or its parent (get_theme_file_uri() in wp-includes/link-template.php) and gives the browser any other source as written (WP_Font_Face_Resolver::to_theme_file_uri() in wp-includes/fonts/class-wp-font-face-resolver.php), so the browser was given font files that do not exist`
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

/**
 * WordPress caches the list of a theme's pattern files (outside theme
 * development mode), so a pattern file added or changed would not register.
 * Clears that theme's cache after a write to its patterns/ directory.
 */
export async function clearThemePatternCache(
	host: StudioAgentHost,
	siteFile: SiteFile
): Promise< string[] > {
	const { siteRoot, theme } = siteFile;
	if ( ! theme || ! /^patterns\/[^/]+\.php$/.test( theme.file ) ) {
		return [];
	}
	await host.sites.wpCli( await host.sites.resolve( siteRoot ), [
		'eval',
		`wp_get_theme( ${ JSON.stringify( theme.slug ) } )->delete_pattern_cache();`,
	] );
	return [];
}

// Whether a front-page template renders a page's content, with its theme's
// patterns: undefined when it includes a pattern the theme does not hold.
async function showsPageContent( theme: NonNullable< SiteFile[ 'theme' ] >, template: string ) {
	const parent = await parentThemeDir( theme.dir );
	return rendersPageContent( template, [ theme.dir, ...( parent ? [ parent ] : [] ) ] );
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
	return ( await showsPageContent( theme, template ) ) === false
		? [ frontPageTemplateProblem( relativePath ) ]
		: [];
}

/**
 * Refuses a new front-page template without a page's content, so the site's
 * front page is a page its owner edits. A template the theme already holds
 * is the theme's own: a change to it is noted instead.
 */
export async function frontPageTemplateRefusal(
	{ siteRoot, relativePath, theme }: SiteFile,
	text: string
): Promise< string | undefined > {
	if ( theme?.file !== FRONT_PAGE_TEMPLATE ) {
		return undefined;
	}
	const exists = await access( path.join( siteRoot, relativePath ) ).then(
		() => true,
		() => false
	);
	// A pattern from elsewhere, such as core's or a plugin's, renders blocks of
	// its own: the post-content block belongs to the template that shows a page.
	return ! exists && ( await showsPageContent( theme, text ) ) !== true
		? frontPageTemplateProblem( relativePath )
		: undefined;
}
