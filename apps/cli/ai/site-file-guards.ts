/**
 * Structural guards for the agent's file tools on a local site.
 *
 * Instead of teaching the model WordPress rules in prose, the Write and Edit
 * tools enforce them at the moment of the change: they refuse writes that
 * WordPress would silently undo (core files, installed third-party themes) and
 * report what WordPress will actually render after a theme change (copies
 * saved in the Site Editor, CSS that fights the block layout).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import type { BlockValidationGate } from 'cli/ai/block-validation-gate';

const STUDIO_THEME_MARKER = 'scaffolded by Studio Code';
const CORE_ROOT_FILE = /^(index|wp-[a-z-]+|xmlrpc)\.php$/;

interface SiteFile {
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

/** Returns why a write to this site file must be refused, or undefined to allow it. */
export function getSiteFileWriteRefusal( siteFile: SiteFile ): string | undefined {
	const { relativePath, theme } = siteFile;
	if (
		relativePath.startsWith( 'wp-includes/' ) ||
		relativePath.startsWith( 'wp-admin/' ) ||
		CORE_ROOT_FILE.test( relativePath )
	) {
		return `${ relativePath } is WordPress core, which is read-only: an update replaces it. Read it as reference, and make the change in wp-content/ (a theme, child theme, or plugin).`;
	}
	if ( theme ) {
		const styleCss = path.join( theme.dir, 'style.css' );
		// No style.css yet means the theme is being created, not an installed one.
		if (
			existsSync( styleCss ) &&
			! readFileSync( styleCss, 'utf8' ).includes( STUDIO_THEME_MARKER )
		) {
			return `${ theme.slug } is an installed theme, and a theme update overwrites changes to its files. Create a child theme with scaffold_theme (parentTheme: "${ theme.slug }") and make the change there.`;
		}
	}
	return undefined;
}

interface SavedCopy {
	id: number;
	postType: string;
	name: string;
}

type SqliteDatabase = {
	prepare( sql: string ): { all( ...params: unknown[] ): unknown[] };
	close(): void;
};

async function withSiteDatabase< T >(
	siteRoot: string,
	query: ( db: SqliteDatabase ) => T
): Promise< T | undefined > {
	const dbPath = path.join( siteRoot, 'wp-content', 'database', '.ht.sqlite' );
	if ( ! existsSync( dbPath ) ) {
		return undefined;
	}
	try {
		const { DatabaseSync } = await import( 'node:sqlite' );
		const db = new DatabaseSync( dbPath, { readOnly: true } ) as unknown as SqliteDatabase;
		try {
			return query( db );
		} finally {
			db.close();
		}
	} catch {
		return undefined;
	}
}

/** Templates and parts saved in the Site Editor for a theme file, which WordPress renders instead of it. */
async function findSavedTemplateCopy(
	siteRoot: string,
	themeSlug: string,
	themeFile: string
): Promise< SavedCopy | undefined > {
	const match = themeFile.match( /^(templates|parts)\/(.+)\.html$/ );
	if ( ! match ) {
		return undefined;
	}
	const postType = match[ 1 ] === 'templates' ? 'wp_template' : 'wp_template_part';
	const rows = await withSiteDatabase( siteRoot, ( db ) =>
		db
			.prepare(
				`SELECT p.ID AS id FROM wp_posts p
				JOIN wp_term_relationships tr ON tr.object_id = p.ID
				JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id = tr.term_taxonomy_id AND tt.taxonomy = 'wp_theme'
				JOIN wp_terms t ON t.term_id = tt.term_id
				WHERE p.post_type = ? AND p.post_name = ? AND t.slug = ? AND p.post_status = 'publish'`
			)
			.all( postType, match[ 2 ], themeSlug )
	);
	const row = rows?.[ 0 ] as { id: number } | undefined;
	return row ? { id: row.id, postType, name: match[ 2 ] } : undefined;
}

/** Global Styles saved in the Site Editor for a theme, which override its theme.json. */
async function findSavedGlobalStyles(
	siteRoot: string,
	themeSlug: string
): Promise< { id: number; keys: string[] } | undefined > {
	const rows = await withSiteDatabase( siteRoot, ( db ) =>
		db
			.prepare(
				`SELECT ID AS id, post_content AS content FROM wp_posts
				WHERE post_type = 'wp_global_styles' AND post_name = ? AND post_status = 'publish'`
			)
			.all( `wp-global-styles-${ encodeURIComponent( themeSlug ) }` )
	);
	const row = rows?.[ 0 ] as { id: number; content: string } | undefined;
	if ( ! row ) {
		return undefined;
	}
	try {
		const parsed = JSON.parse( row.content ) as Record< string, unknown >;
		const keys = [ 'settings', 'styles' ].flatMap( ( section ) =>
			Object.keys( ( parsed[ section ] as Record< string, unknown > ) ?? {} ).map(
				( key ) => `${ section }.${ key }`
			)
		);
		return keys.length ? { id: row.id, keys } : undefined;
	} catch {
		return undefined;
	}
}

const INLINE_DISPLAY = /(^|;|\s)display\s*:\s*inline(-block|-flex|-grid)?\s*(;|$|!)/i;
const BOX_DECLARATION = /(^|;|\s)(padding[a-z-]*|background[a-z-]*|border[a-z-]*)\s*:/i;

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
	const saved = await withSiteDatabase( siteRoot, ( db ) =>
		db
			.prepare(
				`SELECT post_content AS content FROM wp_posts WHERE post_content LIKE '%"className":%' AND post_status = 'publish'`
			)
			.all()
	);
	for ( const row of ( saved ?? [] ) as { content: string }[] ) {
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

/** What WordPress will render differently from the file just written, if anything. */
export async function getSiteFileWriteNotes( siteFile: SiteFile ): Promise< string[] > {
	const { siteRoot, theme } = siteFile;
	if ( ! theme ) {
		return [];
	}
	const notes: string[] = [];
	const savedTemplate = await findSavedTemplateCopy( siteRoot, theme.slug, theme.file );
	if ( savedTemplate ) {
		notes.push(
			`This site has a copy of ${ theme.file } saved in the Site Editor (${ savedTemplate.postType } post ${ savedTemplate.id }), and WordPress renders that copy, not this file. Make the change in post ${ savedTemplate.id } too, keeping the user's other edits there, or tell the user.`
		);
	}
	if ( theme.file === 'theme.json' ) {
		const savedStyles = await findSavedGlobalStyles( siteRoot, theme.slug );
		if ( savedStyles ) {
			notes.push(
				`Global Styles saved in the Site Editor (wp_global_styles post ${
					savedStyles.id
				}) override this theme.json for: ${ savedStyles.keys.join(
					', '
				) }. A change to those values must be made in post ${
					savedStyles.id
				} (keeping the user's other saved values), or it will not show.`
			);
		}
	}
	if ( theme.file.endsWith( '.css' ) ) {
		const css = readFileSync( path.join( theme.dir, theme.file ), 'utf8' );
		notes.push( ...lintThemeCss( css, await getBlockClassNames( siteRoot, theme.dir ) ) );
	}
	return notes;
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
			const refusal = siteFile && getSiteFileWriteRefusal( siteFile );
			if ( refusal ) {
				throw new Error( refusal );
			}
			const result = ( await tool.execute( toolCallId, params, ...rest ) ) as ToolResult;
			if ( siteFile && gate ) {
				gate.track( path.join( siteFile.siteRoot, siteFile.relativePath ), siteFile.siteRoot );
			}
			const notes = siteFile ? await getSiteFileWriteNotes( siteFile ).catch( () => [] ) : [];
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
