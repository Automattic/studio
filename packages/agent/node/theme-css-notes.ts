/**
 * CSS in a theme's stylesheets that fights WordPress's block layout.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { readWordPressSite } from '@studio/agent/node/site-database';
import { readSiteFile, type SiteFile } from '@studio/agent/node/site-file';

const INLINE_DISPLAY = /(^|;|\s)display\s*:\s*inline(-block|-flex|-grid)?\s*(;|$|!)/i;
const BOX_DECLARATION = /(^|;|\s)(padding[a-z-]*|background[a-z-]*|border[a-z-]*)\s*:/i;
const VIEWPORT_BREAKOUT = /calc\(\s*50%\s*-\s*50d?vw\s*\)|(^|;|\s)width\s*:\s*100d?vw/i;

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

// A rule on one class a block carries in its "className" that makes the block inline-level.
function inlineBlockClass(
	selector: string,
	declarations: string,
	blockClassNames: Set< string >
) {
	const single = selector.match( /^\.([A-Za-z0-9_-]+)$/ );
	return Boolean(
		single && blockClassNames.has( single[ 1 ] ) && INLINE_DISPLAY.test( declarations )
	);
}

function inlineDisplayNote( selector: string ): string {
	return `\`${ selector }\` is a block className and gets an inline-level display. Blocks in a constrained layout are placed with auto inline margins (wp-includes/block-supports/layout.php), which inline-level boxes ignore, so this block leaves the content column. To shrink-wrap it, wrap it in a group with a flex layout and drop the display rule.`;
}

/**
 * The classes that the stylesheets in these theme folders make inline-level,
 * each with its note, to check against the classNames of blocks that arrive
 * after the stylesheet does.
 */
export function inlineDisplayClasses( themeDirs: string[] ): { className: string; note: string }[] {
	const found = new Map< string, { className: string; note: string } >();
	for ( const file of themeDirs.flatMap( ( dir ) => listFiles( dir, [ '.css' ] ) ) ) {
		const css = readFileSync( file, 'utf8' ).replace( /\/\*[\s\S]*?\*\//g, '' );
		for ( const rule of css.matchAll( /([^{}]+)\{([^{}]*)\}/g ) ) {
			for ( const selector of rule[ 1 ].split( ',' ).map( ( part ) => part.trim() ) ) {
				const single = selector.match( /^\.([A-Za-z0-9_-]+)$/ );
				const note = `${ file }: ${ inlineDisplayNote( selector ) }`;
				if ( single && INLINE_DISPLAY.test( rule[ 2 ] ) ) {
					found.set( note, { className: single[ 1 ], note } );
				}
			}
		}
	}
	return [ ...found.values() ];
}

/** CSS in a theme stylesheet that fights WordPress's block layout. */
export function lintThemeCss( css: string, blockClassNames: Set< string > ): string[] {
	const notes: string[] = [];
	const withoutComments = css.replace( /\/\*[\s\S]*?\*\//g, '' );
	for ( const rule of withoutComments.matchAll( /([^{}]+)\{([^{}]*)\}/g ) ) {
		const declarations = rule[ 2 ];
		for ( const selector of rule[ 1 ].split( ',' ).map( ( part ) => part.trim() ) ) {
			if ( inlineBlockClass( selector, declarations, blockClassNames ) ) {
				notes.push( inlineDisplayNote( selector ) );
			}
			if ( VIEWPORT_BREAKOUT.test( declarations ) ) {
				notes.push(
					`\`${ selector }\` stretches to the viewport width with CSS. WordPress spans a block across the page with align full (wp-includes/block-supports/layout.php): give the block align full instead, and when it still stops short, a block around it is not full width.`
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

/** CSS in a theme stylesheet just written that fights WordPress's block layout. */
export async function themeCssNotes( siteFile: SiteFile ): Promise< string[] > {
	const { siteRoot, theme } = siteFile;
	return theme?.file.endsWith( '.css' )
		? lintThemeCss( readSiteFile( siteFile ), await getBlockClassNames( siteRoot, theme.dir ) )
		: [];
}
