import { readdir } from 'fs/promises';
import path from 'path';
import { readWordPressSite } from '@studio/agent/node/site-database';
import { activeIsBlockTheme, activeThemes, themesDir } from '@studio/agent/node/themes';
import { boundedText } from '@studio/agent/shared/bounded-list';
import { wpEvalJson } from '@studio/agent/shared/tools/utils';
import type { WordPressSite } from '@studio/agent/node/site-database';
import type { SiteFile } from '@studio/agent/node/site-file';
import type { StudioAgentHost } from '@studio/agent/shared/host';

// A block theme's templates, template parts, and theme.json are only what
// WordPress renders until someone saves a copy in the Site Editor: from then
// on WordPress renders the saved copy (a wp_template or wp_template_part post)
// or applies the saved Global Styles (a wp_global_styles post) over theme.json.
// The copies are read straight from the site's database and stated as a fact
// about the site (site-facts.ts).

type SavedPostType = 'wp_template' | 'wp_template_part' | 'wp_global_styles';

interface SavedCopy {
	postType: SavedPostType;
	id: number;
	// The template or part's slug (the file name without .html).
	slug: string;
	// The theme file the copy is matched to a write by, relative to the theme
	// (or its parent).
	file: string;
	// For Global Styles: the areas they set, such as `color` or `14 block styles`.
	sets?: string[];
}

// The theme folder WordPress reads a template or part's file from.
const THEME_FILE_DIR: Record< 'wp_template' | 'wp_template_part', string > = {
	wp_template: 'templates',
	wp_template_part: 'parts',
};

// The areas saved Global Styles set: each style and setting they hold, with
// per-block styles counted, of Global Styles WordPress applies.
function styleAreas( content: string ): string[] {
	let data: {
		styles?: Record< string, unknown >;
		settings?: Record< string, unknown >;
		isGlobalStylesUserThemeJSON?: unknown;
	};
	try {
		data = JSON.parse( content );
	} catch {
		return [];
	}
	// WordPress applies none of them without the flag (WP_Theme_JSON_Resolver::get_user_data()).
	if ( ! data?.isGlobalStylesUserThemeJSON ) {
		return [];
	}
	const { blocks, ...styles } = data.styles ?? {};
	const blockCount = blocks && typeof blocks === 'object' ? Object.keys( blocks ).length : 0;
	return [
		...Object.keys( styles ),
		...( blockCount ? [ `${ blockCount } block style${ blockCount === 1 ? '' : 's' }` ] : [] ),
		...Object.keys( data.settings ?? {} ).map( ( key ) => `${ key } settings` ),
	];
}

/**
 * The copies saved in the Site Editor for the active theme, read from an open
 * site's database. Global Styles that set nothing are left out.
 */
function readSavedCopies( site: WordPressSite ): SavedCopy[] {
	const [ stylesheet ] = activeThemes( site );
	if ( ! stylesheet ) return [];
	const copies: SavedCopy[] = [];
	for ( const { content, modified, ...row } of savedPosts( site, stylesheet ) ) {
		if ( row.postType === 'wp_global_styles' ) {
			const sets = styleAreas( content );
			if ( sets.length ) {
				copies.push( { ...row, sets, file: 'theme.json' } );
			}
			continue;
		}
		const dir = THEME_FILE_DIR[ row.postType as 'wp_template' | 'wp_template_part' ];
		copies.push( { ...row, file: `${ dir }/${ row.slug }.html` } );
	}
	return copies;
}

export interface SavedPost {
	postType: SavedPostType;
	id: number;
	slug: string;
	modified: string;
	content: string;
}

/**
 * The templates, template parts and Global Styles saved for `theme`, as
 * WordPress picks them: per template or part slug, and for Global Styles,
 * the newest published post whose wp_theme term names the theme
 * (get_block_templates() and
 * WP_Theme_JSON_Resolver::get_user_data_from_wp_global_styles()).
 */
export function savedPosts( site: WordPressSite, theme: string ): SavedPost[] {
	const { prefix } = site;
	const rows = site.query< SavedPost >(
		`SELECT p.ID AS id, p.post_type AS postType, p.post_name AS slug,
				p.post_modified_gmt AS modified, p.post_content AS content
			FROM ${ prefix }posts p
			JOIN ${ prefix }term_relationships tr ON tr.object_id = p.ID
			JOIN ${ prefix }term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = 'wp_theme'
			JOIN ${ prefix }terms t ON t.term_id = tt.term_id
			WHERE p.post_type IN ( 'wp_template', 'wp_template_part', 'wp_global_styles' )
				AND p.post_status = 'publish' AND t.name = ?
			ORDER BY p.post_type, p.post_name, p.post_date DESC, p.ID DESC`,
		theme
	);
	const seen = new Set< string >();
	return rows.filter( ( row ) => {
		const key =
			row.postType === 'wp_global_styles' ? row.postType : `${ row.postType }/${ row.slug }`;
		if ( seen.has( key ) ) return false;
		seen.add( key );
		return true;
	} );
}

function joinList( items: string[] ): string {
	return items.length < 3
		? items.join( ' and ' )
		: `${ items.slice( 0, -1 ).join( ', ' ) }, and ${ items[ items.length - 1 ] }`;
}

const KIND: Record< SavedPostType, string > = {
	wp_template: 'template',
	wp_template_part: 'template part',
	wp_global_styles: 'Global Styles',
};

// The theme file WordPress renders for each saved template and part when it
// is not saved, relative to its theme, or null when the theme has none
// (_get_block_template_file() in wp-includes/block-template-utils.php).
const THEME_FILES = `
$root = wp_normalize_path( realpath( get_theme_root() ) );
$out  = array();
foreach ( $data as $copy ) {
	$file = _get_block_template_file( $copy[0], $copy[1] );
	$out[ implode( '/', $copy ) ] = $file ? substr( wp_normalize_path( $file['path'] ), strlen( "$root/{$file['theme']}/" ) ) : null;
}
echo wp_json_encode( (object) $out );`;

const themeFiles = new Map< string, Promise< Record< string, string | null > | undefined > >();

// WordPress's theme files of the copies, asked again when the copies, the
// active themes, or the names of their template and part files change.
async function themeFilesOf(
	host: StudioAgentHost,
	site: WordPressSite,
	copies: SavedCopy[]
): Promise< Record< string, string | null > | undefined > {
	const templates = copies.filter( ( copy ) => copy.postType !== 'wp_global_styles' );
	const studioSite = templates.length && ( await host.sites.findByFolder( site.root ) );
	if ( ! studioSite ) {
		return undefined;
	}
	const themes = activeThemes( site );
	const names = await Promise.all(
		themes.flatMap( ( theme ) =>
			[ 'templates', 'block-templates', 'parts', 'block-template-parts' ].map( ( folder ) =>
				readdir( path.join( themesDir( site.root, theme ), folder ) ).catch( () => [] )
			)
		)
	);
	const key = JSON.stringify( [ site.root, templates, themes, names ] );
	let files = themeFiles.get( key );
	if ( ! files ) {
		files = wpEvalJson< Record< string, string | null > >(
			host,
			studioSite,
			THEME_FILES,
			templates.map( ( copy ) => [ copy.postType, copy.slug ] )
		).catch( () => undefined );
		themeFiles.set( key, files );
	}
	return files;
}

function describeCopy( copy: SavedCopy, files?: Record< string, string | null > ): string {
	if ( copy.postType === 'wp_global_styles' ) {
		return `Global Styles (post ${ copy.id }), setting ${ joinList( copy.sets ?? [] ) } over ${
			copy.file
		}`;
	}
	const file = files?.[ `${ copy.postType }/${ copy.slug }` ];
	return `the ${ KIND[ copy.postType ] } ${ copy.slug } (post ${ copy.id })${
		file ? `, instead of ${ file }` : ''
	}`;
}

/**
 * Result note for a write to `file` (absolute) that WordPress will not render,
 * because a copy saved in the Site Editor replaces it. Every such write is
 * lost, so every one gets the note.
 */
function savedCopyWriteNote( site: WordPressSite, file: string ): string | undefined {
	const relative = path.relative( site.root, file ).split( path.sep ).join( '/' );
	const copy = readSavedCopies( site ).find( ( candidate ) =>
		activeThemes( site ).some(
			( theme ) => relative === `wp-content/themes/${ theme }/${ candidate.file }`
		)
	);
	if ( ! copy ) {
		return undefined;
	}
	return copy.postType === 'wp_global_styles'
		? `Global Styles saved in the Site Editor (post ${ copy.id }) set ${ joinList(
				copy.sets ?? []
		  ) }, and WordPress applies them over this file.`
		: `WordPress renders the ${ KIND[ copy.postType ] } ${
				copy.slug
		  } from its copy saved in the Site Editor (post ${ copy.id }), not from this file.`;
}

/** That WordPress renders a saved Site Editor copy instead of the file just written. */
export async function savedCopyNotes( { siteRoot, relativePath }: SiteFile ): Promise< string[] > {
	const note = await readWordPressSite( siteRoot, ( site ) =>
		savedCopyWriteNote( site, path.join( siteRoot, relativePath ) )
	);
	return note ? [ note ] : [];
}

// Enough to name the copies of a site whose theme was reworked in the Site Editor.
const MAX_LISTED_COPIES = 10;

/**
 * Site fact: the copies WordPress renders in place of theme files, or, for a
 * block theme (templates/index.html, WP_Theme::is_block_theme()), that there
 * are none, so its files are what WordPress renders.
 */
export async function savedCopiesFact(
	site: WordPressSite,
	host: StudioAgentHost
): Promise< string | undefined > {
	const copies = readSavedCopies( site );
	if ( copies.length ) {
		const files = await themeFilesOf( host, site, copies );
		return `Saved in the Site Editor, so WordPress renders them in place of the active theme's files: ${ boundedText(
			copies.map( ( copy ) => describeCopy( copy, files ) ),
			MAX_LISTED_COPIES,
			'; '
		) }.`;
	}
	return activeIsBlockTheme( site )
		? "Nothing is saved in the Site Editor for the active theme, so WordPress renders its templates, parts and theme.json as the theme's files have them."
		: undefined;
}
