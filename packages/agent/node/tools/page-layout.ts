/**
 * A rendered page's layout as text, for a model that cannot view a
 * screenshot: where the browser put each region of the page (the block
 * theme's header, main and footer, and the blocks main holds) and whether the
 * page is wider than its viewport, measured after the page settles.
 */
import type { getSharedBrowser } from '@studio/agent/node/browser-utils';

type Browser = Awaited< ReturnType< typeof getSharedBrowser > >;
type Page = Awaited< ReturnType< Browser[ 'newPage' ] > >;

// Enough lines for a long page's sections without flooding the result.
const MAX_REGIONS = 40;
// The elements named as making a page wider than its viewport.
const MAX_CAUSES = 5;

export async function pageLayout( page: Page ): Promise< string[] > {
	const regions = page.evaluate( ( maxRegions ) => {
		// Classes that name a block or the author's own, not the layout WordPress generates.
		const generated = /^(is-|has-|wp-container-|wp-elements-|wp-block-[a-z-]+-is-layout-)/;
		const label = ( element: Element ) =>
			element.tagName.toLowerCase() +
			( element.id ? `#${ element.id }` : '' ) +
			[ ...element.classList ]
				.filter( ( name ) => ! generated.test( name ) )
				.slice( 0, 3 )
				.map( ( name ) => `.${ name }` )
				.join( '' );
		const lines: string[] = [];
		let more = 0;
		const visit = ( parent: Element, depth: number ) => {
			for ( const element of parent.children ) {
				const rect = element.getBoundingClientRect();
				if ( rect.width === 0 || rect.height === 0 ) {
					continue;
				}
				if ( lines.length >= maxRegions ) {
					more++;
					continue;
				}
				const top = Math.round( rect.top + window.scrollY );
				lines.push(
					`${ '  '.repeat( depth ) }${ label( element ) }: y ${ top }–${
						top + Math.round( rect.height )
					} (${ Math.round( rect.height ) }px tall), x ${ Math.round( rect.left ) }–${ Math.round(
						rect.right
					) }`
				);
				// A region's blocks are a level down, past wrappers that hold one block.
				const wraps = ( box: Element ): Element =>
					box.children.length === 1 ? wraps( box.children[ 0 ] ) : box;
				if ( depth === 0 ) {
					visit( wraps( element ), 1 );
				}
			}
		};
		visit( document.querySelector( '.wp-site-blocks' ) ?? document.body, 0 );
		if ( more ) {
			lines.push( `…and ${ more } more` );
		}
		return lines;
	}, MAX_REGIONS );
	return [ ...( await regions ), ...( await pageOverflow( page ) ) ];
}

/** Whether the page is wider than its viewport, and the elements that make it so. */
export function pageOverflow( page: Page ): Promise< string[] > {
	return page.evaluate( ( maxCauses ) => {
		const generated = /^(is-|has-|wp-container-|wp-elements-|wp-block-[a-z-]+-is-layout-)/;
		const label = ( element: Element ) =>
			element.tagName.toLowerCase() +
			( element.id ? `#${ element.id }` : '' ) +
			[ ...element.classList ]
				.filter( ( name ) => ! generated.test( name ) )
				.slice( 0, 3 )
				.map( ( name ) => `.${ name }` )
				.join( '' );
		const lines: string[] = [];
		const width = document.documentElement.scrollWidth;
		if ( width > window.innerWidth ) {
			lines.push(
				`The page is ${ width }px wide in a ${ window.innerWidth }px viewport, so it scrolls sideways.`
			);
			// What makes it wider: each element past the viewport whose parent is not.
			// A box that clips its overflow, or a fixed one, adds nothing to the page's width.
			const viewport = document.documentElement.clientWidth;
			const past = ( element: Element ) => {
				const rect = element.getBoundingClientRect();
				return rect.width > 0 && rect.height > 0 && ( rect.right > viewport + 1 || rect.left < -1 );
			};
			// Content that a box clips does not widen the page; a box's own clipping
			// counts for its text, not for the box itself.
			const widens = ( element: Element, clipsItself = false ) => {
				for (
					let box: Element | null = element;
					box && box !== document.body;
					box = box.parentElement
				) {
					const style = getComputedStyle( box );
					if (
						style.position === 'fixed' ||
						( ( clipsItself || box !== element ) && style.overflowX !== 'visible' )
					) {
						return false;
					}
				}
				return true;
			};
			const region = ( element: Element ) =>
				element.closest( 'header, main, footer, .wp-block-template-part' );
			const causes = [ ...document.body.querySelectorAll( '*' ) ].filter(
				( element ) =>
					past( element ) &&
					! (
						element.parentElement &&
						element.parentElement !== document.body &&
						past( element.parentElement )
					) &&
					widens( element )
			);
			const where = ( element: Element ) => {
				const within = region( element );
				return within && within !== element ? `, in ${ label( within ) }` : '';
			};
			const found = causes.map( ( element ) => {
				const rect = element.getBoundingClientRect();
				return `  ${ label( element ) } reaches past it, x ${ Math.round(
					rect.left
				) }–${ Math.round( rect.right ) }${ where( element ) }.`;
			} );
			// Text that does not wrap within its box spills past it, as a box's
			// overflow is visible by default, while the box itself fits.
			const walker = document.createTreeWalker( document.body, NodeFilter.SHOW_TEXT );
			const range = document.createRange();
			for ( let node = walker.nextNode(); node; node = walker.nextNode() ) {
				const element = node.parentElement;
				const text = ( node.textContent ?? '' ).replace( /\s+/g, ' ' ).trim();
				if (
					! element ||
					! text ||
					causes.some( ( cause ) => cause.contains( element ) ) ||
					! widens( element, true )
				) {
					continue;
				}
				range.selectNodeContents( node );
				const rects = [ ...range.getClientRects() ].filter( ( rect ) => rect.width > 0 );
				const left = Math.min( ...rects.map( ( rect ) => rect.left ) );
				const right = Math.max( ...rects.map( ( rect ) => rect.right ) );
				if ( ! rects.length || ( right <= viewport + 1 && left >= -1 ) ) {
					continue;
				}
				// The box the text lays out in: an inline element, as a link, has none of its own.
				let box = element;
				while ( box.parentElement && getComputedStyle( box ).display === 'inline' ) {
					box = box.parentElement;
				}
				const quoted = text.length > 40 ? `${ text.slice( 0, 40 ) }…` : text;
				found.push(
					`  The text "${ quoted }" of ${ label( box ) } reaches past it, x ${ Math.round(
						left
					) }–${ Math.round( right ) }, wider than its ${
						box.clientWidth
					}px box, as the browser does not wrap it there${ where( box ) }.`
				);
			}
			lines.push( ...found.slice( 0, maxCauses ) );
			if ( found.length > maxCauses ) {
				lines.push( `  …and ${ found.length - maxCauses } more.` );
			}
		}
		return lines;
	}, MAX_CAUSES );
}

// Enough lines to show where text does not fit without flooding the result.
const MAX_TEXT_LINES = 10;

/**
 * Where a rendered page's text does not fit, as the browser lays it out: a
 * word it breaks across lines because the word is wider than its box (as the
 * word-break and overflow-wrap rules of core's block styles let it, in
 * wp-includes/css/dist/block-library/style.css), and text that starts or ends
 * at the viewport's edge. A word the page hyphenates is not counted.
 */
export function pageTextFit( page: Page ): Promise< string[] > {
	return page.evaluate( ( maxLines ) => {
		const generated = /^(is-|has-|wp-container-|wp-elements-|wp-block-[a-z-]+-is-layout-)/;
		const label = ( element: Element ) =>
			element.tagName.toLowerCase() +
			[ ...element.classList ]
				.filter( ( name ) => ! generated.test( name ) )
				.slice( 0, 2 )
				.map( ( name ) => `.${ name }` )
				.join( '' );
		const lines: string[] = [];
		const add = ( line: string ) => {
			if ( ! lines.includes( line ) ) {
				lines.push( line );
			}
		};
		const viewport = document.documentElement.clientWidth;
		const walker = document.createTreeWalker( document.body, NodeFilter.SHOW_TEXT );
		const range = document.createRange();
		for ( let node = walker.nextNode(); node; node = walker.nextNode() ) {
			const element = node.parentElement;
			const text = node.textContent ?? '';
			if ( ! element || ! text.trim() ) {
				continue;
			}
			const style = getComputedStyle( element );
			const shown = element.getBoundingClientRect();
			// Text a visitor does not see, as WordPress's screen-reader-text clips it to 1px.
			if (
				style.visibility === 'hidden' ||
				shown.height <= 1 ||
				element.closest( '[aria-hidden="true"]' )
			) {
				continue;
			}
			range.selectNodeContents( node );
			const rects = [ ...range.getClientRects() ].filter( ( rect ) => rect.width > 0 );
			if ( ! rects.length ) {
				continue;
			}
			const left = Math.min( ...rects.map( ( rect ) => rect.left ) );
			const right = Math.max( ...rects.map( ( rect ) => rect.right ) );
			if ( left < 1 ) {
				add(
					`${ label( element ) }: its text starts at the viewport's left edge (x ${ Math.round(
						left
					) }).`
				);
			} else if ( right > viewport - 1 && right <= viewport + 1 ) {
				add(
					`${ label( element ) }: its text ends at the viewport's right edge (x ${ Math.round(
						right
					) }).`
				);
			}
			if ( style.hyphens === 'auto' ) {
				continue;
			}
			const partsOf = ( start: number, end: number ) => {
				range.setStart( node, start );
				range.setEnd( node, end );
				return [ ...range.getClientRects() ].filter( ( rect ) => rect.width > 0 );
			};
			// The browser breaks a run of letters only where the text around it, as
			// an email address, has no place to wrap, so it is that text that is too wide.
			for ( const match of text.matchAll( /\S+/g ) ) {
				const breaks = [ ...match[ 0 ].matchAll( /[\p{L}\p{N}]+/gu ) ].some( ( run ) => {
					const start = match.index + run.index;
					const tops = partsOf( start, start + run[ 0 ].length ).map( ( rect ) =>
						Math.round( rect.top )
					);
					return new Set( tops ).size > 1;
				} );
				if ( breaks ) {
					const parts = partsOf( match.index, match.index + match[ 0 ].length );
					const width = Math.round( parts.reduce( ( sum, rect ) => sum + rect.width, 0 ) );
					const box = element.closest( 'p, h1, h2, h3, h4, h5, h6, li, a, div' ) ?? element;
					const padding =
						parseFloat( getComputedStyle( box ).paddingLeft ) +
						parseFloat( getComputedStyle( box ).paddingRight );
					add(
						`${ label( element ) }: the browser breaks "${
							match[ 0 ]
						}" across lines, as the word (${ width }px) is wider than its box (${ Math.round(
							box.clientWidth - padding
						) }px).`
					);
				}
			}
		}
		return lines.length > maxLines
			? [ ...lines.slice( 0, maxLines ), `…and ${ lines.length - maxLines } more` ]
			: lines;
	}, MAX_TEXT_LINES );
}

/**
 * What a visitor gets that is broken, as the browser loaded the page: PHP's
 * own error output, which PHP prints into the page when display_errors is on
 * (php_error_cb() in main/main.c, as WordPress turns it on with WP_DEBUG in
 * wp_debug_mode()), WordPress's critical error screen (wp_die() from
 * WP_Fatal_Error_Handler::display_default_error_template()), and images the
 * browser could not load.
 */
export function pageBreakage( page: Page ): Promise< string[] > {
	return page.evaluate( () => {
		const lines: string[] = [];
		const text = document.body?.innerText ?? '';
		for ( const match of text.matchAll(
			/\b(Fatal error|Parse error|Warning|Notice|Deprecated): (.{0,200}?) in (\S+) on line (\d+)/g
		) ) {
			lines.push(
				`PHP printed "${ match[ 1 ] }: ${ match[ 2 ] }" (${ match[ 3 ] }:${ match[ 4 ] }).`
			);
		}
		if ( text.includes( 'There has been a critical error on this website.' ) ) {
			lines.push( 'WordPress shows its critical error screen in place of the page.' );
		}
		for ( const image of document.images ) {
			if ( image.complete && image.naturalWidth === 0 && image.currentSrc ) {
				lines.push( `The image ${ image.currentSrc } did not load.` );
			}
		}
		return [ ...new Set( lines ) ];
	} );
}
