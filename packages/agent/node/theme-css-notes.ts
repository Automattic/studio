/**
 * CSS in a theme's stylesheets that fights WordPress's block layout.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
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

// Each selector of each rule in a stylesheet, with the rule's declarations.
function selectorRules( css: string ): Array< [ selector: string, declarations: string ] > {
	return [ ...css.replace( /\/\*[\s\S]*?\*\//g, '' ).matchAll( /([^{}]+)\{([^{}]*)\}/g ) ].flatMap(
		( rule ) =>
			rule[ 1 ].split( ',' ).map( ( part ): [ string, string ] => [ part.trim(), rule[ 2 ] ] )
	);
}

function inlineDisplayNote( selector: string ): string {
	return `\`${ selector }\` is a block className and gets an inline-level display, and a block with it sits directly in a constrained layout. Blocks in a constrained layout are placed with auto inline margins (wp-includes/block-supports/layout.php), which inline-level boxes ignore, so this block leaves the content column. To shrink-wrap it, wrap it in a group with a flex layout and drop the display rule.`;
}

/**
 * The classes that the stylesheets in these theme folders make inline-level,
 * each with its note, to check against the blocks WordPress places in a
 * constrained layout (inline-block-classes.ts), which alone raises the note:
 * a stylesheet's text cannot tell where its class's blocks sit.
 */
export function inlineDisplayClasses( themeDirs: string[] ): { className: string; note: string }[] {
	const found = new Map< string, { className: string; note: string } >();
	for ( const file of themeDirs.flatMap( ( dir ) => listFiles( dir, [ '.css' ] ) ) ) {
		for ( const [ selector, declarations ] of selectorRules( readFileSync( file, 'utf8' ) ) ) {
			const single = selector.match( /^\.([A-Za-z0-9_-]+)$/ );
			const note = `${ file }: ${ inlineDisplayNote( selector ) }`;
			if ( single && INLINE_DISPLAY.test( declarations ) ) {
				found.set( note, { className: single[ 1 ], note } );
			}
		}
	}
	return [ ...found.values() ];
}

/** CSS in a theme stylesheet that fights WordPress's block layout. */
export function lintThemeCss( css: string ): string[] {
	const notes: string[] = [];
	for ( const [ selector, declarations ] of selectorRules( css ) ) {
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
	return notes;
}

/** CSS in a theme stylesheet just written that fights WordPress's block layout. */
export async function themeCssNotes( siteFile: SiteFile ): Promise< string[] > {
	return siteFile.theme?.file.endsWith( '.css' ) ? lintThemeCss( readSiteFile( siteFile ) ) : [];
}
