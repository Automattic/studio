import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { getWordPressVersionFromInstallation } from 'cli/lib/dependency-management/wordpress';
import type { SiteInfo } from 'cli/ai/types';

// A block theme's templates, template parts, and theme.json are only what
// WordPress renders until someone saves a copy in the Site Editor: from then
// on WordPress renders the saved copy (a wp_template or wp_template_part post)
// or applies the saved Global Styles (a wp_global_styles post) over theme.json.
// The copies are read straight from the site's SQLite database, for the
// active site's facts.

type SavedPostType = 'wp_template' | 'wp_template_part' | 'wp_global_styles';

export interface SavedCopy {
	postType: SavedPostType;
	id: number;
	// The template or part's slug (the file name without .html).
	slug: string;
	// For a template or part: whether the theme (or its parent) has a file for it.
	hasThemeFile?: boolean;
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
export async function readSavedCopies( root: string ): Promise< SavedCopy[] > {
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
			const themeDirs = [ stylesheet, option( 'template' ) ?? stylesheet ].map( ( theme ) =>
				path.join( root, 'wp-content', 'themes', theme )
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
				.all( stylesheet ) as unknown as Array< SavedCopy & { content: string } >;
			const copies: SavedCopy[] = [];
			const seen = new Set< string >();
			for ( const { content, ...row } of rows ) {
				const key =
					row.postType === 'wp_global_styles' ? row.postType : `${ row.postType }/${ row.slug }`;
				if ( seen.has( key ) ) continue;
				seen.add( key );
				if ( row.postType === 'wp_global_styles' ) {
					const sets = styleAreas( content );
					if ( sets.length ) copies.push( { ...row, sets } );
					continue;
				}
				const hasThemeFile = themeDirs.some( ( themeDir ) =>
					THEME_FILE_DIRS[ row.postType as 'wp_template' | 'wp_template_part' ].some( ( dir ) =>
						existsSync( path.join( themeDir, dir, `${ row.slug }.html` ) )
					)
				);
				copies.push( { ...row, hasThemeFile } );
			}
			return copies;
		} finally {
			db.close();
		}
	} catch {
		return [];
	}
}

// "templates index (post 8), single (9); template parts header (5)"
function listByType( copies: SavedCopy[] ): string {
	const groups = (
		[
			[ 'wp_template', 'template', 'templates' ],
			[ 'wp_template_part', 'template part', 'template parts' ],
		] as const
	 )
		.map( ( [ postType, one, many ] ) => {
			const ofType = copies.filter( ( copy ) => copy.postType === postType );
			const items = ofType.map(
				( copy, i ) => `${ copy.slug } (${ i === 0 ? 'post ' : '' }${ copy.id })`
			);
			return ofType.length ? `${ ofType.length === 1 ? one : many } ${ items.join( ', ' ) }` : '';
		} )
		.filter( Boolean );
	return groups.join( '; ' );
}

/** One line for the active site's facts, or undefined when nothing is saved. */
export function formatSavedCopies( copies: SavedCopy[] ): string | undefined {
	const overriding = listByType( copies.filter( ( copy ) => copy.hasThemeFile ) );
	const editorOnly = listByType( copies.filter( ( copy ) => copy.hasThemeFile === false ) );
	const styles = copies.find( ( copy ) => copy.postType === 'wp_global_styles' );
	const sentences = [
		overriding &&
			`Saved in the Site Editor, which WordPress uses instead of the theme's files: ${ overriding }.`,
		editorOnly && `Only in the Site Editor: ${ editorOnly }.`,
		styles &&
			`Global Styles (post ${ styles.id }), applied over theme.json, set ${ joinList(
				styles.sets ?? []
			) }.`,
	].filter( Boolean );
	return sentences.length ? sentences.join( ' ' ) : undefined;
}

function joinList( items: string[] ): string {
	return items.length < 3
		? items.join( ' and ' )
		: `${ items.slice( 0, -1 ).join( ', ' ) }, and ${ items[ items.length - 1 ] }`;
}

/**
 * Facts about a local site read from its own files and database, one line
 * each, for the Active site section: the WordPress version it runs and the
 * copies saved in the Site Editor.
 */
export async function readActiveSiteFacts( site?: SiteInfo | null ): Promise< string[] > {
	if ( ! site || site.remote ) {
		return [];
	}
	const [ version, savedCopies ] = await Promise.all( [
		getWordPressVersionFromInstallation( site.path ),
		readSavedCopies( site.path ),
	] );
	return [
		version ? `WordPress ${ version }.` : undefined,
		formatSavedCopies( savedCopies ),
	].filter( ( fact ): fact is string => Boolean( fact ) );
}
