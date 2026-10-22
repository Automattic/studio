import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { findWordPressRoot, resolveToolPath } from 'cli/ai/runtimes/pi/tool-safety';

// A block theme's templates, template parts, and theme.json are only what
// WordPress renders until someone saves a copy in the Site Editor: from then
// on WordPress renders the saved copy (a wp_template or wp_template_part post)
// or applies the saved Global Styles (a wp_global_styles post) over theme.json.
// The copies are read straight from the site's SQLite database. The active
// site's facts list them, and reading or writing a file they override says so.

type SavedPostType = 'wp_template' | 'wp_template_part' | 'wp_global_styles';

export interface SavedCopy {
	postType: SavedPostType;
	id: number;
	// The template or part's slug (the file name without .html).
	slug: string;
	// For Global Styles: what they set, as paths such as `styles.color.background`.
	sets?: string[];
}

const TEMPLATE_DIRS: Record< string, 'wp_template' | 'wp_template_part' > = {
	templates: 'wp_template',
	'block-templates': 'wp_template',
	parts: 'wp_template_part',
	'block-template-parts': 'wp_template_part',
};

const LABELS: Record< SavedPostType, string > = {
	wp_template: 'template',
	wp_template_part: 'template part',
	wp_global_styles: 'Global Styles',
};

function tablePrefix( root: string ): string {
	try {
		const config = readFileSync( path.join( root, 'wp-config.php' ), 'utf8' );
		return config.match( /\$table_prefix\s*=\s*['"]([A-Za-z0-9_]+)['"]/ )?.[ 1 ] ?? 'wp_';
	} catch {
		return 'wp_';
	}
}

// Paths of what saved Global Styles set, to two levels below styles/settings.
function stylePaths( content: string ): string[] {
	let data: Record< string, unknown >;
	try {
		data = JSON.parse( content ) as Record< string, unknown >;
	} catch {
		return [];
	}
	const paths: string[] = [];
	for ( const top of [ 'styles', 'settings' ] ) {
		const section = data[ top ];
		if ( ! section || typeof section !== 'object' ) continue;
		for ( const [ key, value ] of Object.entries( section ) ) {
			if ( value && typeof value === 'object' && ! Array.isArray( value ) ) {
				paths.push( ...Object.keys( value ).map( ( child ) => `${ top }.${ key }.${ child }` ) );
			} else {
				paths.push( `${ top }.${ key }` );
			}
		}
	}
	return paths;
}

/**
 * The copies saved in the Site Editor for `theme` (a theme folder name; the
 * active theme when omitted) on the WordPress install at `root`. Global Styles
 * that set nothing are left out. Never throws: a site without a readable
 * database has none.
 */
export async function readSavedCopies( root: string, theme?: string ): Promise< SavedCopy[] > {
	const dbPath = path.join( root, 'wp-content', 'database', '.ht.sqlite' );
	if ( ! existsSync( dbPath ) ) {
		return [];
	}
	try {
		const { DatabaseSync } = await import( 'node:sqlite' );
		const db = new DatabaseSync( dbPath, { readOnly: true } );
		try {
			const prefix = tablePrefix( root );
			const stylesheet =
				theme ??
				(
					db
						.prepare(
							`SELECT option_value AS value FROM ${ prefix }options WHERE option_name = 'stylesheet'`
						)
						.get() as { value: string } | undefined
				 )?.value;
			if ( ! stylesheet ) return [];
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
				.all( stylesheet ) as unknown as Array< SavedCopy & { content: string } >;
			const copies: SavedCopy[] = [];
			const seen = new Set< string >();
			for ( const { content, ...row } of rows ) {
				const key =
					row.postType === 'wp_global_styles' ? row.postType : `${ row.postType }/${ row.slug }`;
				if ( seen.has( key ) ) continue;
				seen.add( key );
				if ( row.postType !== 'wp_global_styles' ) {
					copies.push( row );
					continue;
				}
				const sets = stylePaths( content );
				if ( sets.length ) copies.push( { ...row, sets } );
			}
			return copies;
		} finally {
			db.close();
		}
	} catch {
		return [];
	}
}

/** One line for the active site's facts, or undefined when nothing is saved. */
export function formatSavedCopies( copies: SavedCopy[] ): string | undefined {
	if ( ! copies.length ) return undefined;
	const items = copies.map( ( copy ) =>
		copy.postType === 'wp_global_styles'
			? `Global Styles (post ${ copy.id }, sets ${ copy.sets?.join( ', ' ) })`
			: `${ LABELS[ copy.postType ] } \`${ copy.slug }\` (post ${ copy.id })`
	);
	return `Saved in the Site Editor, so WordPress renders these instead of the theme's files: ${ items.join(
		'; '
	) }.`;
}

/**
 * The note for reading or writing `relativePath` (relative to the WordPress
 * root `root`) when a copy saved in the Site Editor overrides that file.
 */
export async function getSavedOverrideNote(
	root: string,
	relativePath: string
): Promise< string | undefined > {
	const parts = relativePath.split( '/' );
	if ( parts[ 0 ] !== 'wp-content' || parts[ 1 ] !== 'themes' || ! parts[ 2 ] ) {
		return undefined;
	}
	const isThemeJson = parts.length === 4 && parts[ 3 ] === 'theme.json';
	const postType =
		parts.length === 5 && parts[ 4 ].endsWith( '.html' ) && TEMPLATE_DIRS[ parts[ 3 ] ];
	if ( ! isThemeJson && ! postType ) {
		return undefined;
	}
	const slug = parts[ 4 ]?.slice( 0, -'.html'.length );
	const copy = ( await readSavedCopies( root, parts[ 2 ] ) ).find( ( saved ) =>
		isThemeJson
			? saved.postType === 'wp_global_styles'
			: saved.postType === postType && saved.slug === slug
	);
	if ( ! copy ) {
		return undefined;
	}
	if ( copy.postType === 'wp_global_styles' ) {
		return `WordPress applies the Global Styles saved in the Site Editor (wp_global_styles post ${
			copy.id
		}) over this theme.json, so a change here to what they set does not show on the site; a change to post ${
			copy.id
		} does. They set: ${ copy.sets?.join( ', ' ) }.`;
	}
	return `WordPress renders the copy of this ${
		LABELS[ copy.postType ]
	} saved in the Site Editor (${ copy.postType } post ${
		copy.id
	}), not this file, so a change to this file does not show on the site. A change to post ${
		copy.id
	} does, and keeps the edits made there.`;
}

interface FileTool {
	execute(
		toolCallId: string,
		params: { path?: unknown },
		...rest: never[]
	): Promise< { content: Array< { type: string } > } >;
}

/** Read, Write, or Edit, with the note above appended to the result when it applies. */
export function withSavedOverrideNote< TTool extends FileTool >( tool: TTool, cwd: string ): TTool {
	return {
		...tool,
		async execute( toolCallId: string, params: { path?: unknown }, ...rest: never[] ) {
			const result = await tool.execute( toolCallId, params, ...rest );
			const filePath = resolveToolPath( String( params.path ), cwd );
			const root = findWordPressRoot( filePath );
			const note = root
				? await getSavedOverrideNote(
						root,
						path.relative( root, filePath ).split( path.sep ).join( '/' )
				  )
				: undefined;
			return note
				? { ...result, content: [ ...result.content, { type: 'text', text: note } ] }
				: result;
		},
	};
}
