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

export function pageLayout( page: Page ): Promise< string[] > {
	return page.evaluate( ( maxRegions ) => {
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
			const widens = ( element: Element ) => {
				for (
					let box: Element | null = element;
					box && box !== document.body;
					box = box.parentElement
				) {
					const style = getComputedStyle( box );
					if (
						style.position === 'fixed' ||
						( box !== element && style.overflowX !== 'visible' )
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
			for ( const element of causes.slice( 0, 5 ) ) {
				const rect = element.getBoundingClientRect();
				const within = region( element );
				lines.push(
					`  ${ label( element ) } reaches past it, x ${ Math.round( rect.left ) }–${ Math.round(
						rect.right
					) }${ within && within !== element ? `, in ${ label( within ) }` : '' }.`
				);
			}
			if ( causes.length > 5 ) {
				lines.push( `  …and ${ causes.length - 5 } more.` );
			}
		}
		return lines;
	}, MAX_REGIONS );
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
			for ( const match of text.matchAll( /[\p{L}\p{N}]+/gu ) ) {
				range.setStart( node, match.index );
				range.setEnd( node, match.index + match[ 0 ].length );
				const parts = [ ...range.getClientRects() ].filter( ( rect ) => rect.width > 0 );
				const tops = new Set( parts.map( ( rect ) => Math.round( rect.top ) ) );
				if ( tops.size > 1 ) {
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
