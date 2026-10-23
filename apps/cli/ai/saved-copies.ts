import { existsSync, readFileSync } from 'fs';
import path from 'path';

// A block theme's templates, template parts, and theme.json are only what
// WordPress renders until someone saves a copy in the Site Editor: from then
// on WordPress renders the saved copy (a wp_template or wp_template_part post)
// or applies the saved Global Styles (a wp_global_styles post) over theme.json.
// The copies are read straight from the site's SQLite database, when a tool
// call or result names one of the theme files they replace.

type SavedPostType = 'wp_template' | 'wp_template_part' | 'wp_global_styles';

export interface SavedCopy {
	postType: SavedPostType;
	id: number;
	// The template or part's slug (the file name without .html).
	slug: string;
	// The theme files, relative to the site root, that WordPress reads in place
	// of this copy when it is not saved: the template or part's file in the
	// theme or its parent, or their theme.json.
	files: string[];
	// For Global Styles: the areas they set, such as `color` or `14 block styles`.
	sets?: string[];
}

// The theme folders WordPress reads a template or part's file from.
const THEME_FILE_DIRS: Record< 'wp_template' | 'wp_template_part', string[] > = {
	wp_template: [ 'templates', 'block-templates' ],
	wp_template_part: [ 'parts', 'block-template-parts' ],
};

function tablePrefix( root: string ): string {
	try {
		const config = readFileSync( path.join( root, 'wp-config.php' ), 'utf8' );
		return config.match( /\$table_prefix\s*=\s*['"]([A-Za-z0-9_]+)['"]/ )?.[ 1 ] ?? 'wp_';
	} catch {
		return 'wp_';
	}
}

// The areas saved Global Styles set: each style and setting they hold, with
// per-block styles counted.
function styleAreas( content: string ): string[] {
	let data: { styles?: Record< string, unknown >; settings?: Record< string, unknown > };
	try {
		data = JSON.parse( content );
	} catch {
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
 * The copies saved in the Site Editor for the active theme of the WordPress
 * install at `root`. Global Styles that set nothing are left out. Never
 * throws: a site without a readable database has none.
 */
async function readSavedCopies( root: string ): Promise< SavedCopy[] > {
	const dbPath = path.join( root, 'wp-content', 'database', '.ht.sqlite' );
	if ( ! existsSync( dbPath ) ) {
		return [];
	}
	try {
		const { DatabaseSync } = await import( 'node:sqlite' );
		const db = new DatabaseSync( dbPath, { readOnly: true } );
		try {
			const prefix = tablePrefix( root );
			const option = ( name: string ) =>
				(
					db
						.prepare( `SELECT option_value AS value FROM ${ prefix }options WHERE option_name = ?` )
						.get( name ) as { value: string } | undefined
				 )?.value;
			const stylesheet = option( 'stylesheet' );
			if ( ! stylesheet ) return [];
			const themeDirs = [ ...new Set( [ stylesheet, option( 'template' ) ?? stylesheet ] ) ].map(
				( theme ) => `wp-content/themes/${ theme }`
			);
			// The latest published post per type and slug, for the theme its
			// wp_theme term names.
			const rows = db
				.prepare(
					`SELECT p.ID AS id, p.post_type AS postType, p.post_name AS slug, p.post_content AS content
					FROM ${ prefix }posts p
					JOIN ${ prefix }term_relationships tr ON tr.object_id = p.ID
					JOIN ${ prefix }term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = 'wp_theme'
					JOIN ${ prefix }terms t ON t.term_id = tt.term_id
					WHERE p.post_type IN ( 'wp_template', 'wp_template_part', 'wp_global_styles' )
						AND p.post_status = 'publish' AND t.name = ?
					ORDER BY p.post_type, p.post_name, p.post_date DESC, p.ID DESC`
				)
				.all( stylesheet ) as unknown as Array< Omit< SavedCopy, 'files' > & { content: string } >;
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
						copies.push( {
							...row,
							sets,
							files: themeDirs.map( ( dir ) => `${ dir }/theme.json` ),
						} );
					}
					continue;
				}
				const files = themeDirs.flatMap( ( themeDir ) =>
					THEME_FILE_DIRS[ row.postType as 'wp_template' | 'wp_template_part' ].map(
						( dir ) => `${ themeDir }/${ dir }/${ row.slug }.html`
					)
				);
				copies.push( { ...row, files } );
			}
			return copies;
		} finally {
			db.close();
		}
	} catch {
		return [];
	}
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

function describeCopy( copy: SavedCopy, file: string ): string {
	if ( copy.postType === 'wp_global_styles' ) {
		return `Global Styles saved in the Site Editor (post ${ copy.id }) set ${ joinList(
			copy.sets ?? []
		) }, and WordPress applies them over ${ file }.`;
	}
	return `WordPress renders the ${ KIND[ copy.postType ] } ${
		copy.slug
	} from its copy saved in the Site Editor (post ${ copy.id }), not from ${ file }.`;
}

// A theme template, part, or theme.json named in a path.
const THEME_FILE = /themes\/[^/\s"'`]+\/(?:theme\.json|[\w-]+\/[\w.-]+\.html)/;

/**
 * Returns a function that, given a tool call's arguments and result as text,
 * states each copy saved in the Site Editor that replaces a theme file the
 * text names, once per tracker. The copies are read when a theme file is
 * named, so copies saved during the turn count.
 */
export function createSavedCopyNotes( sitePath: string ): ( text: string ) => Promise< string > {
	const described = new Set< number >();
	return async ( text ) => {
		const normalized = text.replace( /\\+/g, '/' );
		if ( ! THEME_FILE.test( normalized ) ) {
			return '';
		}
		const notes: string[] = [];
		for ( const copy of await readSavedCopies( sitePath ) ) {
			const file = copy.files.find( ( candidate ) =>
				normalized.includes( candidate.slice( 'wp-content/'.length ) )
			);
			if ( file && ! described.has( copy.id ) ) {
				described.add( copy.id );
				notes.push( describeCopy( copy, file ) );
			}
		}
		return notes.join( '\n' );
	};
}
