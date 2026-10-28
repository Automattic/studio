import path from 'path';
import { activeThemes } from '@studio/agent/node/themes';
import type { WordPressSite } from '@studio/agent/node/site-database';

// A block theme's templates, template parts, and theme.json are only what
// WordPress renders until someone saves a copy in the Site Editor: from then
// on WordPress renders the saved copy (a wp_template or wp_template_part post)
// or applies the saved Global Styles (a wp_global_styles post) over theme.json.
// The copies are read straight from the site's database and stated as a fact
// about the site (site-facts.ts).

type SavedPostType = 'wp_template' | 'wp_template_part' | 'wp_global_styles';

export interface SavedCopy {
	postType: SavedPostType;
	id: number;
	// The template or part's slug (the file name without .html).
	slug: string;
	// The theme file WordPress renders when the copy is not saved, relative to
	// the theme (or its parent).
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
export function readSavedCopies( site: WordPressSite ): SavedCopy[] {
	const { prefix } = site;
	const [ stylesheet ] = activeThemes( site );
	if ( ! stylesheet ) return [];
	// The latest published post per type and slug, for the theme its wp_theme
	// term names.
	const rows = site.query< Omit< SavedCopy, 'file' > & { content: string } >(
		`SELECT p.ID AS id, p.post_type AS postType, p.post_name AS slug, p.post_content AS content
			FROM ${ prefix }posts p
			JOIN ${ prefix }term_relationships tr ON tr.object_id = p.ID
			JOIN ${ prefix }term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = 'wp_theme'
			JOIN ${ prefix }terms t ON t.term_id = tt.term_id
			WHERE p.post_type IN ( 'wp_template', 'wp_template_part', 'wp_global_styles' )
				AND p.post_status = 'publish' AND t.name = ?
			ORDER BY p.post_type, p.post_name, p.post_date DESC, p.ID DESC`,
		stylesheet
	);
	const copies: SavedCopy[] = [];
	const seen = new Set< string >();
	for ( const { content, ...row } of rows ) {
		const key =
			row.postType === 'wp_global_styles' ? row.postType : `${ row.postType }/${ row.slug }`;
		if ( seen.has( key ) ) continue;
		seen.add( key );
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

function describeCopy( copy: SavedCopy ): string {
	const { file } = copy;
	if ( copy.postType === 'wp_global_styles' ) {
		return `Global Styles (post ${ copy.id }), setting ${ joinList(
			copy.sets ?? []
		) } over ${ file }`;
	}
	return `the ${ KIND[ copy.postType ] } ${ copy.slug } (post ${ copy.id }), instead of ${ file }`;
}

/**
 * Result note for a write to `file` (absolute) that WordPress will not render,
 * because a copy saved in the Site Editor replaces it. Every such write is
 * lost, so every one gets the note.
 */
export function savedCopyWriteNote( site: WordPressSite, file: string ): string | undefined {
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

/** Site fact: the copies WordPress renders in place of theme files. */
export function savedCopiesFact( site: WordPressSite ): string | undefined {
	const copies = readSavedCopies( site );
	return copies.length
		? `Saved in the Site Editor, so WordPress renders them in place of the active theme's files: ${ copies
				.map( describeCopy )
				.join( '; ' ) }.`
		: undefined;
}
