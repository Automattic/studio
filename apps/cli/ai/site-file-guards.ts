/**
 * Structural guards for the agent's file tools on a local site.
 *
 * Instead of teaching the model WordPress rules in prose, the Write and Edit
 * tools act on them at the moment of the change: they register a theme's new
 * patterns and report CSS that fights the block layout. Refusals live in
 * tool-safety.ts and saved Site Editor copies in result notes.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { resolveSite } from 'cli/ai/tools/utils';
import { connectToDaemon, disconnectFromDaemon } from 'cli/lib/daemon-client';
import { runWpCliCommand } from 'cli/lib/run-wp-cli-command';
import type { BlockValidationGate } from 'cli/ai/block-validation-gate';

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
	if ( theme.file.endsWith( '.css' ) ) {
		const css = readFileSync( path.join( theme.dir, theme.file ), 'utf8' );
		notes.push( ...lintThemeCss( css, await getBlockClassNames( siteRoot, theme.dir ) ) );
	}
	return notes;
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
			if ( siteFile ) {
				await clearThemePatternCache( siteFile ).catch( () => undefined );
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
