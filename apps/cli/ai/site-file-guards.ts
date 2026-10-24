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
import path from 'path';
import { savedCopyWriteNote } from 'cli/ai/saved-copies';
import { readWordPressSite } from 'cli/ai/site-database';
import { isUpdatableTheme } from 'cli/ai/themes';
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
		reason = `${ theme.slug } is a theme WordPress updates, and an update overwrites changes to its files. Create a child theme with scaffold_theme (parentTheme: "${ theme.slug }") and make the change there.`;
	}
	if ( ! reason || ! ( await isStudioSite( siteRoot ) ) ) {
		return undefined;
	}
	return `Not run: ${ reason }`;
}

/** What WordPress will render differently from the file just written, if anything. */
async function getSiteFileWriteNotes( siteFile: SiteFile ): Promise< string[] > {
	const { siteRoot, relativePath, theme } = siteFile;
	if ( ! theme ) {
		return [];
	}
	const notes: string[] = [];
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
 * After a write to a site's file: registers a changed pattern, and returns
 * what WordPress will render differently from the file.
 */
export async function afterSiteFileWrite( siteFile: SiteFile ): Promise< string[] > {
	await clearThemePatternCache( siteFile ).catch( () => undefined );
	return getSiteFileWriteNotes( siteFile ).catch( () => [] );
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
