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
	// For Global Styles: what they set, as paths such as `styles.color.background`.
	sets?: string[];
}

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
			const stylesheet = (
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
	const items = copies.map( ( copy ) => {
		switch ( copy.postType ) {
			case 'wp_global_styles':
				return `Global Styles (post ${
					copy.id
				}), which WordPress applies over theme.json; they set ${ copy.sets?.join( ', ' ) }`;
			case 'wp_template':
				return `template \`${ copy.slug }\` (post ${ copy.id }), which WordPress renders instead of templates/${ copy.slug }.html`;
			case 'wp_template_part':
				return `template part \`${ copy.slug }\` (post ${ copy.id }), which WordPress renders instead of parts/${ copy.slug }.html`;
		}
	} );
	return `Saved in the Site Editor: ${ items.join( '; ' ) }.`;
}

/**
 * Facts about a local site read from its own files and database, one line
 * each, for the Active site section: the WordPress it runs, where that
 * WordPress declares its block types, and the copies saved in the Site Editor.
 */
export async function readActiveSiteFacts( site?: SiteInfo | null ): Promise< string[] > {
	if ( ! site || site.remote ) {
		return [];
	}
	const [ version, savedCopies ] = await Promise.all( [
		getWordPressVersionFromInstallation( site.path ),
		readSavedCopies( site.path ),
	] );
	const blocks = path.join( site.path, 'wp-includes', 'blocks' ).split( path.sep ).join( '/' );
	return [
		version
			? `WordPress ${ version }. Its core block types, with their attributes and supports, are declared in ${ blocks }/<block>/block.json.`
			: undefined,
		formatSavedCopies( savedCopies ),
	].filter( ( fact ): fact is string => Boolean( fact ) );
}
